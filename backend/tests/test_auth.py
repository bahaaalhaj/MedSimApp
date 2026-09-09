from __future__ import annotations

import tempfile
import unittest
import uuid
import sys
from contextlib import closing
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi.testclient import TestClient

import server
from auth_system import AuthRepository, AuthService, AuthSettings, iso, utcnow


class AuthenticationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        settings = replace(
            AuthSettings.from_env(),
            database_path=Path(self.temp.name) / "auth-test.db",
            cookie_secure=False,
            cookie_domain=None,
        )
        server.auth_api.settings = settings
        server.auth_api.service = AuthService(AuthRepository(settings.database_path), settings)
        self.client = TestClient(server.app, client=(f"test-{uuid.uuid4()}", 50000))
        self.headers = {"Origin": "http://localhost:5173"}
        session = self.client.get("/api/auth/session", headers=self.headers)
        self.csrf = session.json()["csrfToken"]
        self.write_headers = {**self.headers, "x-csrf-token": self.csrf}

    def tearDown(self) -> None:
        self.client.close()
        self.temp.cleanup()

    def register(self, email: str = "doctor@example.com", name: str = "Dr Noor"):
        return self.client.post(
            "/api/auth/register",
            headers=self.write_headers,
            json={
                "display_name": name,
                "email": email,
                "password": "correct-horse-42",
                "terms_accepted": True,
                "remember": True,
            },
        )

    def logout(self):
        return self.client.post("/api/auth/logout", headers=self.write_headers)

    def test_successful_registration_hashes_password_and_sets_session(self) -> None:
        response = self.register()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["user"]["displayName"], "Dr Noor")
        row = server.auth_api.service.repository.user_by_email("doctor@example.com")
        self.assertIsNotNone(row)
        self.assertNotEqual(row["password_hash"], "correct-horse-42")
        self.assertTrue(row["password_hash"].startswith("$argon2id$"))
        self.assertIn("HttpOnly", response.headers["set-cookie"])

    def test_duplicate_email_is_rejected_safely(self) -> None:
        self.assertEqual(self.register().status_code, 201)
        response = self.register("DOCTOR@example.com")
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("exists", response.text.lower())

    def test_invalid_email_and_weak_password_are_rejected(self) -> None:
        bad_email = self.client.post("/api/auth/register", headers=self.write_headers, json={"display_name": "Doctor", "email": "bad", "password": "correct-horse-42", "terms_accepted": True})
        weak = self.client.post("/api/auth/register", headers=self.write_headers, json={"display_name": "Doctor", "email": "valid@example.com", "password": "short", "terms_accepted": True})
        self.assertEqual(bad_email.status_code, 422)
        self.assertEqual(weak.status_code, 422)

    def test_successful_login_and_session_lookup(self) -> None:
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.logout().status_code, 204)
        response = self.client.post("/api/auth/login", headers=self.write_headers, json={"email": "DOCTOR@example.com", "password": "correct-horse-42", "remember": False})
        self.assertEqual(response.status_code, 200, response.text)
        session = self.client.get("/api/auth/session", headers=self.headers)
        self.assertTrue(session.json()["authenticated"])
        self.assertEqual(session.json()["user"]["email"], "doctor@example.com")

    def test_incorrect_password_and_unknown_user_share_generic_error(self) -> None:
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.logout().status_code, 204)
        wrong = self.client.post("/api/auth/login", headers=self.write_headers, json={"email": "doctor@example.com", "password": "wrong"})
        unknown = self.client.post("/api/auth/login", headers=self.write_headers, json={"email": "nobody@example.com", "password": "wrong"})
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json()["detail"]["message"], unknown.json()["detail"]["message"])

    def test_expired_and_revoked_sessions_are_rejected(self) -> None:
        self.assertEqual(self.register().status_code, 201)
        repo = server.auth_api.service.repository
        token = self.client.cookies.get(server.auth_api.SESSION_COOKIE)
        with closing(repo.connect()) as conn, conn:
            conn.execute("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?", (iso(utcnow() - timedelta(seconds=1)), server.auth_api.service.token_hash(token)))
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 401)
        self.client.cookies.clear()
        self.client.get("/api/auth/session", headers=self.headers)
        self.csrf = self.client.cookies.get(server.auth_api.CSRF_COOKIE)

    def test_logout_revokes_server_session(self) -> None:
        self.assertEqual(self.register().status_code, 201)
        self.assertEqual(self.logout().status_code, 204)
        session = self.client.get("/api/auth/session", headers=self.headers)
        self.assertFalse(session.json()["authenticated"])

    def test_protected_progress_requires_session(self) -> None:
        response = self.client.get("/api/progress/encounters", headers=self.headers)
        self.assertEqual(response.status_code, 401)

    def test_one_user_cannot_read_another_users_encounter(self) -> None:
        self.assertEqual(self.register("one@example.com", "One Doctor").status_code, 201)
        payload = {
            "caseId": "im-001", "caseName": "Synthetic Patient", "caseAge": 35,
            "caseGender": "F", "diagnosisLabel": "Training diagnosis", "verdict": "good",
            "evaluation": {"global_rating": "good"}, "patientSnapshot": {"arrivedAt": 1000},
        }
        created = self.client.post("/api/progress/encounters", headers=self.write_headers, json=payload)
        self.assertEqual(created.status_code, 201, created.text)
        encounter_id = created.json()["id"]
        self.assertEqual(self.logout().status_code, 204)
        self.client.get("/api/auth/session", headers=self.headers)
        self.csrf = self.client.cookies.get(server.auth_api.CSRF_COOKIE)
        self.write_headers["x-csrf-token"] = self.csrf
        self.assertEqual(self.register("two@example.com", "Two Doctor").status_code, 201)
        response = self.client.get(f"/api/progress/encounters/{encounter_id}", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    def test_z_rate_limit_rejects_repeated_login_attempts(self) -> None:
        statuses = [self.client.post("/api/auth/login", headers=self.write_headers, json={"email": "nobody@example.com", "password": "wrong"}).status_code for _ in range(11)]
        self.assertIn(429, statuses)


if __name__ == "__main__":
    unittest.main()

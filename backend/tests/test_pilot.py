"""Pilot security/ownership/streaming checks without hosted inference or TTS."""
from __future__ import annotations

import asyncio
import os
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from contextlib import closing
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx
import uvicorn
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from slowapi import Limiter
from slowapi.util import get_remote_address

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth_system import AuthSettings
from medsim_backend.application import create_application
from medsim_backend.config import RuntimeSettings, pilot_origin
from medsim_backend.guest_session import GUEST_COOKIE
from medsim_backend.pilot import register_frontend
from medsim_backend.runtime import create_runtime
from pilot_backup import backup_database

ORIGIN = "https://medsim-pilot.ngrok-free.app"
HOST = ORIGIN.removeprefix("https://")


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        env = patch.dict(os.environ, {
            "MEDSIM_PILOT_MODE": "1", "MEDSIM_PILOT_ORIGIN": ORIGIN,
            "MEDSIM_DATABASE_PATH": str(root / "pilot.db"),
            "PATIENT_TTS_PROVIDER": "disabled", "PATIENT_TTS_FALLBACK": "disabled",
        })
        env.start()
        self.addCleanup(env.stop)
        self.runtime = create_runtime()
        self.app = self.runtime.app
        self.dist = root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<html>pilot build</html>")
        for name in ("main.js", "main.js.map", "manifest.json", ".env", "records.db"):
            (self.dist / "assets" / name).write_text("fixture")
        register_frontend(self.app, self.dist)
        self.one = self.client()
        self.two = self.client()
        self.case = self.runtime.safe_curated_cases[0]

    def client(self):
        # Identical peer IP and UA, as for students behind the same ngrok agent.
        client = TestClient(self.app, base_url=ORIGIN, client=("127.0.0.1", 50000),
                            headers={"Origin": ORIGIN, "User-Agent": "same-browser"})
        self.addCleanup(client.close)
        return client

    def attempt(self, client):
        response = client.post("/api/attempts", json={"caseId": self.case["caseId"], "caseVersion": self.case["caseVersion"]})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["attemptId"]

    def register(self, client, email):
        session = client.get("/api/auth/session")
        client.headers["x-csrf-token"] = session.json()["csrfToken"]
        response = client.post("/api/auth/register", json={"display_name": "Pilot Student", "email": email,
                               "password": "pilot-test-password-42", "terms_accepted": True})
        self.assertEqual(response.status_code, 201, response.text)
        return response

    def test_exact_hosts_origins_and_forwarded_headers(self):
        self.assertEqual(self.one.get("/").status_code, 200)
        for headers in ({"Host": "attacker.example"}, {"Host": HOST + ".attacker.example"},
                        {"Origin": "http://localhost:5173"}, {"Origin": ORIGIN + ".attacker.example"},
                        {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertIn(self.one.get("/api/clinical/cases", headers=headers).status_code, {400, 403})
        spoofed = {"Host": "attacker.example", "X-Forwarded-Host": HOST,
                   "X-Forwarded-Proto": "https", "Forwarded": f"host={HOST};proto=https"}
        self.assertEqual(self.one.get("/", headers=spoofed).status_code, 400)
        self.assertEqual(self.one.get("/", headers={"X-Forwarded-Host": "attacker.example",
                         "X-Forwarded-For": "8.8.8.8"}).status_code, 200)
        self.assertEqual(self.one.get("/health").json(), {"ok": True, "pilot": True})
        self.one.headers.pop("origin")
        self.assertEqual(self.one.post("/api/attempts", json={}).status_code, 403)
        self.assertEqual(self.one.post("/api/attempts", headers={"Referer": ORIGIN + ".evil/"}, json={}).status_code, 403)
        self.assertEqual(self.one.post("/api/attempts", headers={"Referer": ORIGIN + "/"}, json={}).status_code, 422)
        external = TestClient(self.app, base_url=ORIGIN, client=("203.0.113.2", 50000))
        self.addCleanup(external.close)
        self.assertEqual(external.get("/", headers={"X-Forwarded-For": "127.0.0.1"}).status_code, 400)

    def test_only_build_assets_are_served(self):
        self.assertEqual(self.one.get("/assets/main.js").status_code, 200)
        for path in ("/.env", "/backend/.env.local", "/backend/server.py", "/src/main.tsx", "/package.json",
                     "/vercel.json", "/.git/config", "/backend/data/medsim.db", "/docs/generated/curation-manifest.json",
                     "/docs/generated/local-ai-manifest.server.json", "/docs", "/redoc", "/openapi.json",
                     "/assets/main.js.map", "/assets/manifest.json", "/assets/.env", "/assets/records.db",
                     "/assets/%2e%2e/backend/server.py", "/assets/..%5cbackend/server.py", "/api/missing", "/agent/missing", "/tts/missing"):
            response = self.one.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertNotIn("pilot build", response.text)
        outside = Path(self.directory.name) / "outside.js"
        outside.write_text("private-source")
        with patch.object(Path, "resolve", autospec=True, return_value=outside):
            self.assertEqual(self.one.get("/assets/escape.js").status_code, 404)

    def test_guests_with_identical_ip_and_user_agent_are_isolated(self):
        aid = self.attempt(self.one)
        other_aid = self.attempt(self.two)
        self.assertNotEqual(self.one.cookies.get(GUEST_COOKIE), self.two.cookies.get(GUEST_COOKIE))
        self.assertNotEqual(aid, other_aid)
        path = f"/api/attempts/{aid}/investigations"
        self.assertEqual(self.one.get(path, headers={"User-Agent": "changed-UA"}).status_code, 200)
        self.assertEqual(self.two.get(path).status_code, 404)
        for endpoint, payload in (("examinations", {"actionId": "general-observation", "performedAt": 1}),
                                  ("completion", {}), ("investigations/orders", {"investigationId": "cbc"})):
            self.assertEqual(self.two.post(f"/api/attempts/{aid}/{endpoint}", json=payload).status_code, 404)
        for path, payload in (("/agent/patient/stream", {"attemptId": aid, "source": "typed", "question": "What is your name?"}),
                              ("/api/local-ai/evaluate", {"attemptId": aid, "caseId": self.case["caseId"], "caseVersion": self.case["caseVersion"]}),
                              ("/tts/synthesize", {"attemptId": aid, "caseId": self.case["caseId"], "caseVersion": self.case["caseVersion"], "text": "Hello"})):
            self.assertEqual(self.two.post(path, json=payload).status_code, 404)
        self.assertEqual(self.two.get("/api/progress/encounters").status_code, 401)
        self.two.cookies.clear()
        forged = self.one.cookies.get(GUEST_COOKIE).split(".")[0] + "." + "0" * 64
        self.two.cookies.set(GUEST_COOKIE, forged, domain=HOST, path="/")
        self.assertEqual(self.two.get(f"/api/attempts/{aid}/investigations").status_code, 404)

    def test_accounts_cannot_read_mutate_or_delete_each_others_data(self):
        response = self.register(self.one, "one@example.com")
        session_cookie = next(value for value in response.headers.get_list("set-cookie") if value.startswith("medsim_session="))
        for value in (session_cookie, *self.one.get("/api/auth/session").headers.get_list("set-cookie")):
            self.assertIn("Secure", value)
            self.assertIn("SameSite=lax", value)
            self.assertNotIn("Domain=", value)
        self.assertIn("HttpOnly", session_cookie)
        self.register(self.two, "two@example.com")
        aid = self.attempt(self.one)
        self.assertEqual(self.two.get(f"/api/attempts/{aid}/investigations").status_code, 404)
        payload = {"caseId": self.case["caseId"], "caseName": "Synthetic", "caseAge": 35, "caseGender": "F",
                   "diagnosisLabel": "Training", "verdict": "good", "evaluation": {}, "patientSnapshot": {}}
        saved = self.one.post("/api/progress/encounters", json=payload)
        self.assertEqual(saved.status_code, 201, saved.text)
        eid = saved.json()["id"]
        self.assertEqual(self.two.get("/api/progress/encounters").json(), {"encounters": []})
        self.assertEqual(self.two.get(f"/api/progress/encounters/{eid}").status_code, 404)
        self.assertEqual(self.two.delete(f"/api/progress/encounters/{eid}").status_code, 404)
        self.assertEqual(self.one.get(f"/api/progress/encounters/{eid}").status_code, 200)
        self.assertEqual(self.one.post("/api/auth/logout", headers={"x-csrf-token": "bad"}).status_code, 403)

    def test_real_patient_sse_and_text_only_tts_failure(self):
        aid = self.attempt(self.one)
        with patch("medsim_backend.services.patient_dialogue_service.get_local_llm_provider") as provider:
            result = self.one.post("/agent/patient/stream", json={"attemptId": aid, "source": "typed", "question": "What is your name?"})
        provider.assert_not_called()
        self.assertEqual(result.status_code, 200)
        self.assertIn("text/event-stream", result.headers["content-type"])
        self.assertEqual(result.headers["x-accel-buffering"], "no")
        self.assertIn("no-transform", result.headers["cache-control"])
        self.assertIn('"done":true', result.text)
        result = self.one.post("/tts/synthesize", json={"attemptId": aid, "caseId": self.case["caseId"],
                               "caseVersion": self.case["caseVersion"], "text": "Hello"})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(self.one.get(f"/api/attempts/{aid}/investigations").status_code, 200)

    def test_delayed_stream_reaches_socket_before_generator_finishes(self):
        gate = threading.Event()
        async def generator():
            yield b"data: first\n\n"
            while not gate.is_set():
                await asyncio.sleep(0.01)
            yield b"data: last\n\n"
        # Insert before the static catchall; never present in the pilot entry point.
        async def probe():
            return StreamingResponse(generator(), media_type="text/event-stream")
        self.app.add_api_route("/agent/stream-probe", probe)
        self.app.router.routes.insert(0, self.app.router.routes.pop())
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            config = uvicorn.Config(self.app, lifespan="off", proxy_headers=False, log_level="error")
            server = uvicorn.Server(config)
            thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 5
                while not server.started and thread.is_alive() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(server.started)
                with httpx.Client(base_url=f"http://127.0.0.1:{sock.getsockname()[1]}", trust_env=False, timeout=3) as client:
                    with client.stream("GET", "/agent/stream-probe", headers={"Host": HOST, "Origin": ORIGIN}) as response:
                        self.assertEqual(response.status_code, 200)
                        chunks = response.iter_bytes()
                        self.assertIn(b"data: first", next(chunks))
                        self.assertFalse(gate.is_set())
                        gate.set()
                        self.assertIn(b"data: last", b"".join(chunks))
            finally:
                gate.set()
                server.should_exit = True
                thread.join(5)
                self.assertFalse(thread.is_alive())


class PilotConfigurationTests(unittest.TestCase):
    def test_origin_configuration_fails_closed(self):
        for value in ("", "http://pilot.ngrok-free.app", "https://*.ngrok-free.app", ORIGIN + "/", ORIGIN + ":443",
                      "https://user@pilot.ngrok-free.app", "https://bad..example", "https://-bad.example"):
            with self.assertRaises(ValueError):
                pilot_origin(value)
        self.assertEqual(pilot_origin(ORIGIN), ORIGIN)

    def test_header_spoof_cannot_bypass_secret_and_legitimate_access_remains(self):
        base = RuntimeSettings("edge-test-secret", ["http://localhost:5173"], {"http://localhost:5173"})
        for development in (False, True):
            app = create_application(replace(base, development_access=development), Limiter(key_func=get_remote_address))
            app.add_api_route("/private", lambda: {"ok": True})
            for peer in ("127.0.0.1", "203.0.113.3"):
                with TestClient(app, client=(peer, 50000)) as client:
                    expected = 200 if development and peer == "127.0.0.1" else 401
                    for headers in ({"Origin": "http://localhost:5173"}, {"Referer": "http://localhost:5173/"}):
                        self.assertEqual(client.get("/private", headers=headers).status_code, expected)
                    self.assertEqual(client.get("/private", headers={"x-medsim-auth": "edge-test-secret"}).status_code, 200)

    def test_pilot_cookie_settings_override_insecure_development_env(self):
        with patch.dict(os.environ, {"MEDSIM_PILOT_MODE": "1", "MEDSIM_COOKIE_SECURE": "0",
                                    "MEDSIM_COOKIE_SAMESITE": "none", "MEDSIM_COOKIE_DOMAIN": ".example.com"}):
            settings = AuthSettings.from_env()
        self.assertTrue(settings.cookie_secure)
        self.assertEqual(settings.cookie_samesite, "lax")
        self.assertIsNone(settings.cookie_domain)

    def test_sqlite_backup_includes_committed_wal_without_changing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.db"
            with closing(sqlite3.connect(source)) as connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("CREATE TABLE evidence (value TEXT)")
                connection.execute("INSERT INTO evidence VALUES ('preserved')")
                connection.commit()
                target = backup_database(source, Path(directory) / "backups")
                with closing(sqlite3.connect(target)) as snapshot:
                    self.assertEqual(snapshot.execute("SELECT value FROM evidence").fetchone()[0], "preserved")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM evidence").fetchone()[0], 1)

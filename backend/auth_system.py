from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


@dataclass(frozen=True)
class AuthSettings:
    database_path: Path
    cookie_secure: bool
    cookie_samesite: Literal["lax", "strict", "none"]
    cookie_domain: str | None
    session_hours: int
    remember_days: int

    @classmethod
    def from_env(cls) -> "AuthSettings":
        backend_dir = Path(__file__).resolve().parent
        production = os.environ.get("MEDSIM_ENVIRONMENT", "development").lower() in {"production", "prod"} or os.environ.get("RENDER", "").lower() == "true"
        raw_samesite = os.environ.get("MEDSIM_COOKIE_SAMESITE", "lax").lower()
        samesite: Literal["lax", "strict", "none"] = (
            raw_samesite if raw_samesite in {"lax", "strict", "none"} else "lax"
        )  # type: ignore[assignment]
        secure_default = "1" if production else "0"
        secure = os.environ.get("MEDSIM_COOKIE_SECURE", secure_default).lower() in {"1", "true", "yes"}
        if samesite == "none" and not secure:
            raise RuntimeError("MEDSIM_COOKIE_SAMESITE=none requires MEDSIM_COOKIE_SECURE=1")
        return cls(
            database_path=Path(os.environ.get("MEDSIM_DATABASE_PATH", backend_dir / "data" / "medsim.db")),
            cookie_secure=secure,
            cookie_samesite=samesite,
            cookie_domain=os.environ.get("MEDSIM_COOKIE_DOMAIN") or None,
            session_hours=max(1, int(os.environ.get("MEDSIM_SESSION_HOURS", "24"))),
            remember_days=max(1, int(os.environ.get("MEDSIM_REMEMBER_DAYS", "30"))),
        )


class AuthRepository:
    def __init__(self, database_path: Path, migrations_dir: Path | None = None):
        self.database_path = database_path
        self.migrations_dir = migrations_dir or Path(__file__).resolve().parent / "migrations"
        self._lock = threading.RLock()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def migrate(self) -> None:
        with self._lock, closing(self.connect()) as conn, conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            applied = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
            for path in sorted(self.migrations_dir.glob("*.sql")):
                if path.name in applied:
                    continue
                conn.executescript(path.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (path.name, iso(utcnow())),
                )

    def create_user(self, display_name: str, email: str, password_hash: str) -> sqlite3.Row:
        now = iso(utcnow())
        user_id = str(uuid.uuid4())
        with self._lock, closing(self.connect()) as conn, conn:
            conn.execute(
                "INSERT INTO users(id, display_name, email, password_hash, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, display_name, email, password_hash, now, now),
            )
            return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    def user_by_email(self, email: str) -> sqlite3.Row | None:
        with closing(self.connect()) as conn:
            return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    def create_session(self, user_id: str, token_hash: str, expires_at: datetime) -> sqlite3.Row:
        now = iso(utcnow())
        session_id = str(uuid.uuid4())
        with self._lock, closing(self.connect()) as conn, conn:
            conn.execute(
                "INSERT INTO auth_sessions(id, token_hash, user_id, created_at, expires_at, last_used_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, token_hash, user_id, now, iso(expires_at), now),
            )
            return conn.execute("SELECT * FROM auth_sessions WHERE id = ?", (session_id,)).fetchone()

    def session_user(self, token_hash: str) -> sqlite3.Row | None:
        now = iso(utcnow())
        with self._lock, closing(self.connect()) as conn, conn:
            row = conn.execute(
                "SELECT s.id AS session_id, s.expires_at, s.revoked_at, "
                "u.id, u.display_name, u.email, u.created_at, u.is_active "
                "FROM auth_sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ?",
                (token_hash,),
            ).fetchone()
            if not row or row["revoked_at"] or not row["is_active"] or row["expires_at"] <= now:
                return None
            conn.execute(
                "UPDATE auth_sessions SET last_used_at = ? WHERE id = ?",
                (now, row["session_id"]),
            )
            return row

    def revoke_session(self, token_hash: str) -> None:
        with self._lock, closing(self.connect()) as conn, conn:
            conn.execute(
                "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
                (iso(utcnow()), token_hash),
            )

    def create_encounter(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        now = iso(utcnow())
        encounter_id = str(uuid.uuid4())
        saved_at = int(utcnow().timestamp() * 1000)
        entry = {**payload, "id": encounter_id, "savedAt": saved_at}
        with self._lock, closing(self.connect()) as conn, conn:
            conn.execute(
                "INSERT INTO clinical_encounters(id, user_id, case_id, status, started_at, ended_at, "
                "created_at, updated_at, summary_json, evaluation_json, patient_snapshot_json) "
                "VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)",
                (
                    encounter_id,
                    user_id,
                    payload["caseId"],
                    iso(datetime.fromtimestamp(payload["patientSnapshot"].get("arrivedAt", saved_at) / 1000, timezone.utc)),
                    now,
                    now,
                    now,
                    json.dumps(entry, separators=(",", ":")),
                    json.dumps(payload["evaluation"], separators=(",", ":")),
                    json.dumps(payload["patientSnapshot"], separators=(",", ":")),
                ),
            )
        return entry

    def list_encounters(self, user_id: str) -> list[dict[str, Any]]:
        with closing(self.connect()) as conn:
            rows = conn.execute(
                "SELECT summary_json FROM clinical_encounters WHERE user_id = ? "
                "ORDER BY created_at DESC LIMIT 100",
                (user_id,),
            ).fetchall()
        return [json.loads(row["summary_json"]) for row in rows]

    def get_encounter(self, user_id: str, encounter_id: str) -> dict[str, Any] | None:
        with closing(self.connect()) as conn:
            row = conn.execute(
                "SELECT summary_json FROM clinical_encounters WHERE id = ? AND user_id = ?",
                (encounter_id, user_id),
            ).fetchone()
        return json.loads(row["summary_json"]) if row else None

    def delete_encounter(self, user_id: str, encounter_id: str) -> bool:
        with self._lock, closing(self.connect()) as conn, conn:
            cur = conn.execute(
                "DELETE FROM clinical_encounters WHERE id = ? AND user_id = ?",
                (encounter_id, user_id),
            )
            return cur.rowcount > 0


class AuthService:
    def __init__(self, repository: AuthRepository, settings: AuthSettings):
        self.repository = repository
        self.settings = settings
        self.passwords = PasswordHasher()
        self._dummy_hash = self.passwords.hash(secrets.token_urlsafe(24))

    @staticmethod
    def token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_user(self, display_name: str, email: str, password: str) -> sqlite3.Row:
        return self.repository.create_user(display_name, email, self.passwords.hash(password))

    def verify_login(self, email: str, password: str) -> sqlite3.Row | None:
        user = self.repository.user_by_email(email)
        if not user or not user["is_active"]:
            try:
                self.passwords.verify(self._dummy_hash, password)
            except VerifyMismatchError:
                pass
            return None
        try:
            if not self.passwords.verify(user["password_hash"], password):
                return None
        except (VerifyMismatchError, InvalidHashError):
            return None
        return user

    def issue_session(self, user_id: str, remember: bool) -> tuple[str, datetime]:
        token = secrets.token_urlsafe(32)
        delta = timedelta(days=self.settings.remember_days) if remember else timedelta(hours=self.settings.session_hours)
        expires = utcnow() + delta
        self.repository.create_session(user_id, self.token_hash(token), expires)
        return token, expires

    def current_user(self, token: str | None) -> sqlite3.Row | None:
        return self.repository.session_user(self.token_hash(token)) if token else None


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=60)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    terms_accepted: bool
    remember: bool = True

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("Display name must be at least 2 characters")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    @field_validator("terms_accepted")
    @classmethod
    def require_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Terms acknowledgement is required")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class EncounterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    case_id: str = Field(alias="caseId", min_length=1, max_length=100)
    case_name: str = Field(alias="caseName", min_length=1, max_length=200)
    case_age: int = Field(alias="caseAge", ge=0, le=130)
    case_gender: Literal["M", "F"] = Field(alias="caseGender")
    diagnosis_label: str = Field(alias="diagnosisLabel", max_length=300)
    verdict: Literal["excellent", "good", "satisfactory", "borderline", "clear-fail"]
    evaluation: dict[str, Any]
    patient_snapshot: dict[str, Any] = Field(alias="patientSnapshot")


class AuthApi:
    SESSION_COOKIE = "medsim_session"
    CSRF_COOKIE = "medsim_csrf"

    def __init__(self, settings: AuthSettings):
        self.settings = settings
        self.service = AuthService(AuthRepository(settings.database_path), settings)

    @staticmethod
    def public_user(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "displayName": row["display_name"],
            "email": row["email"],
            "createdAt": row["created_at"],
        }

    def set_session_cookie(self, response: Response, token: str, expires: datetime, remember: bool) -> None:
        response.set_cookie(
            self.SESSION_COOKIE,
            token,
            httponly=True,
            secure=self.settings.cookie_secure,
            samesite=self.settings.cookie_samesite,
            domain=self.settings.cookie_domain,
            path="/",
            max_age=int((expires - utcnow()).total_seconds()) if remember else None,
        )

    def clear_session_cookie(self, response: Response) -> None:
        response.delete_cookie(
            self.SESSION_COOKIE,
            domain=self.settings.cookie_domain,
            path="/",
            secure=self.settings.cookie_secure,
            samesite=self.settings.cookie_samesite,
        )

    def ensure_csrf(self, request: Request, response: Response) -> str:
        token = request.cookies.get(self.CSRF_COOKIE) or secrets.token_urlsafe(24)
        response.set_cookie(
            self.CSRF_COOKIE,
            token,
            httponly=False,
            secure=self.settings.cookie_secure,
            samesite=self.settings.cookie_samesite,
            domain=self.settings.cookie_domain,
            path="/",
            max_age=365 * 24 * 60 * 60,
        )
        return token

    def require_csrf(self, request: Request) -> None:
        cookie = request.cookies.get(self.CSRF_COOKIE, "")
        header = request.headers.get("x-csrf-token", "")
        if not cookie or not header or not hmac.compare_digest(cookie, header):
            raise HTTPException(status_code=403, detail={"code": "csrf_failed", "message": "Security check failed. Refresh and try again."})

    def require_user(self, request: Request) -> sqlite3.Row:
        user = self.service.current_user(request.cookies.get(self.SESSION_COOKIE))
        if not user:
            raise HTTPException(status_code=401, detail={"code": "not_authenticated", "message": "Please sign in to continue."})
        return user


def build_auth_router(auth_api: AuthApi, limiter: Any) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/auth/session")
    def session(request: Request, response: Response):
        csrf = auth_api.ensure_csrf(request, response)
        user = auth_api.service.current_user(request.cookies.get(auth_api.SESSION_COOKIE))
        return {"authenticated": bool(user), "user": auth_api.public_user(user) if user else None, "csrfToken": csrf}

    @router.get("/auth/me")
    def me(request: Request):
        return {"user": auth_api.public_user(auth_api.require_user(request))}

    @router.post("/auth/register", status_code=201)
    @limiter.limit("5/minute")
    def register(payload: RegisterRequest, request: Request, response: Response):
        auth_api.require_csrf(request)
        try:
            user = auth_api.service.create_user(payload.display_name, str(payload.email), payload.password)
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail={"code": "registration_failed", "message": "Unable to create an account with those details."})
        token, expires = auth_api.service.issue_session(user["id"], payload.remember)
        auth_api.set_session_cookie(response, token, expires, payload.remember)
        return {"user": auth_api.public_user(user)}

    @router.post("/auth/login")
    @limiter.limit("10/minute")
    def login(payload: LoginRequest, request: Request, response: Response):
        auth_api.require_csrf(request)
        user = auth_api.service.verify_login(str(payload.email), payload.password)
        if not user:
            raise HTTPException(status_code=401, detail={"code": "invalid_credentials", "message": "Invalid email or password."})
        previous = request.cookies.get(auth_api.SESSION_COOKIE)
        if previous:
            auth_api.service.repository.revoke_session(auth_api.service.token_hash(previous))
        token, expires = auth_api.service.issue_session(user["id"], payload.remember)
        auth_api.set_session_cookie(response, token, expires, payload.remember)
        return {"user": auth_api.public_user(user)}

    @router.post("/auth/logout", status_code=204)
    def logout(request: Request, response: Response):
        auth_api.require_csrf(request)
        token = request.cookies.get(auth_api.SESSION_COOKIE)
        if token:
            auth_api.service.repository.revoke_session(auth_api.service.token_hash(token))
        auth_api.clear_session_cookie(response)

    @router.get("/progress/encounters")
    def list_encounters(request: Request):
        user = auth_api.require_user(request)
        return {"encounters": auth_api.service.repository.list_encounters(user["id"])}

    @router.get("/progress/encounters/{encounter_id}")
    def get_encounter(encounter_id: str, request: Request):
        user = auth_api.require_user(request)
        item = auth_api.service.repository.get_encounter(user["id"], encounter_id)
        if not item:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Encounter not found."})
        return item

    @router.post("/progress/encounters", status_code=201)
    def create_encounter(payload: EncounterRequest, request: Request):
        auth_api.require_csrf(request)
        user = auth_api.require_user(request)
        return auth_api.service.repository.create_encounter(user["id"], payload.model_dump(by_alias=True))

    @router.delete("/progress/encounters/{encounter_id}", status_code=204)
    def delete_encounter(encounter_id: str, request: Request):
        auth_api.require_csrf(request)
        user = auth_api.require_user(request)
        if not auth_api.service.repository.delete_encounter(user["id"], encounter_id):
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Encounter not found."})

    return router

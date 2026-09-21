from __future__ import annotations

import hashlib
import threading
import time
from typing import Any

from fastapi import HTTPException, Request


ATTEMPT_TTL_SECONDS = 6 * 60 * 60
MAX_ACTIVE_ATTEMPTS_PER_OWNER = 32


class AttemptStore:
    """Existing in-memory attempt state, isolated from HTTP route definitions."""

    def __init__(self, auth_api: Any):
        self.auth_api = auth_api
        self.attempts: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    def owner(self, request: Request) -> str:
        user = self.auth_api.service.current_user(request.cookies.get(self.auth_api.SESSION_COOKIE))
        if user:
            return f"user:{user['id']}"
        raw = f"{request.client.host if request.client else ''}|{request.headers.get('user-agent', '')}"
        return "guest:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, request: Request, attempt_id: str) -> dict[str, Any]:
        attempt = self.attempts.get(attempt_id)
        if not attempt or attempt["expiresAt"] <= time.time() or attempt["owner"] != self.owner(request):
            raise HTTPException(status_code=404, detail="attempt not found")
        return attempt

    def clean(self, now: float, owner: str) -> None:
        expired = [key for key, value in self.attempts.items() if value["expiresAt"] <= now]
        for key in expired:
            self.attempts.pop(key, None)
        owned = sorted(
            ((key, value) for key, value in self.attempts.items() if value["owner"] == owner),
            key=lambda pair: pair[1]["createdAt"],
        )
        for key, _ in owned[:-(MAX_ACTIVE_ATTEMPTS_PER_OWNER - 1)]:
            self.attempts.pop(key, None)

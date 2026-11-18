from __future__ import annotations

import threading
import secrets
import time
from contextlib import contextmanager, asynccontextmanager
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
        self.distributed = False

    @contextmanager
    def transaction(self, request: Request, attempt_id: str):
        with self.lock:
            yield self.get(request, attempt_id)

    @asynccontextmanager
    async def atransaction(self, request: Request, attempt_id: str):
        with self.transaction(request, attempt_id) as attempt:
            yield attempt

    def create(self, request: Request, attempt: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.clean(time.time(), self.owner(request))
            existing = next((item for item in self.attempts.values() if attempt.get('clientAttemptId') and
                (item['owner'], item['caseId'], item['caseVersion'], item.get('clientAttemptId')) ==
                (attempt['owner'], attempt['caseId'], attempt['caseVersion'], attempt['clientAttemptId'])), None)
            if existing:
                return existing
            self.attempts[attempt['attemptId']] = attempt
            return attempt

    def assert_mutable(self, attempt: dict[str, Any]) -> None:
        if self.distributed and (attempt.get('evaluationActive') or attempt.get('evaluationResult')):
            raise HTTPException(409, 'This encounter is being evaluated or is complete.')

    def claim(self, attempt: dict[str, Any], kind: str, request_id: str = '') -> str:
        if not self.distributed:
            return ''
        token = secrets.token_urlsafe(24)
        attempt[kind + 'Lease'] = {'token': token, 'expiresAt': time.time() + 30, 'requestId': request_id}
        return token

    def check_claim(self, attempt: dict[str, Any], kind: str, token: str) -> None:
        if self.distributed:
            lease = attempt.get(kind + 'Lease', {})
            if lease.get('token') != token or lease.get('expiresAt', 0) <= time.time():
                raise HTTPException(409, 'The operation lease expired; recover the encounter.')

    def finish_claim(self, attempt: dict[str, Any], kind: str, token: str) -> None:
        if not self.distributed or attempt.get(kind + 'Lease', {}).get('token') == token:
            attempt[kind + 'Active'] = False
            attempt.pop(kind + 'Lease', None)

    def owner(self, request: Request) -> str:
        user = self.auth_api.service.current_user(request.cookies.get(self.auth_api.SESSION_COOKIE))
        if user:
            return f"user:{user['id']}"
        guest_id = getattr(request.state, "guest_id", None)
        if not guest_id:
            raise HTTPException(status_code=401, detail="anonymous session required")
        return "guest:" + guest_id

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

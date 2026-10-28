"""Opaque, signed browser sessions for anonymous attempt ownership.

The signing key lives for this process, like the in-memory attempts. Restarting
invalidates both. Neither IP, User-Agent nor forwarded headers confer ownership.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

from starlette.requests import Request
from starlette.responses import Response

GUEST_COOKIE = "medsim_guest"


class GuestSessionMiddleware:
    def __init__(self, app, secure: bool):
        self.app = app
        self.secure = secure
        self.key = secrets.token_bytes(32)

    def sign(self, value: str) -> str:
        return hmac.new(self.key, value.encode("ascii"), hashlib.sha256).hexdigest()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        cookie = Request(scope).cookies.get(GUEST_COOKIE, "")
        value, _, signature = cookie.partition(".")
        valid = (len(value) == 43 and value.isascii() and len(signature) == 64 and signature.isascii()
                 and hmac.compare_digest(signature, self.sign(value)))
        if not valid:
            value = secrets.token_urlsafe(32)
        scope.setdefault("state", {})["guest_id"] = value

        async def session_send(message):
            if message["type"] == "http.response.start" and not valid:
                response = Response()
                response.set_cookie(GUEST_COOKIE, value + "." + self.sign(value),
                                    httponly=True, secure=self.secure, samesite="lax", path="/")
                message = {**message, "headers": [*message.get("headers", []),
                           *[(k, v) for k, v in response.raw_headers if k == b"set-cookie"]]}
            await send(message)

        await self.app(scope, receive, session_send)

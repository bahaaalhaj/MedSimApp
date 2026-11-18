"""Opaque, signed browser sessions for anonymous attempt ownership.

Ordinary mode uses a process key matching its in-memory attempts. The separate
demo injects a stable server key and host-only secure cookie name. Neither IP,
User-Agent nor forwarded headers confer ownership.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

from starlette.requests import Request
from starlette.responses import Response

GUEST_COOKIE = "medsim_guest"


class GuestSessionMiddleware:
    def __init__(self, app, secure: bool, signing_key: bytes | None = None, cookie_name: str = GUEST_COOKIE):
        self.app = app
        self.secure = secure
        self.key = signing_key if signing_key is not None else secrets.token_bytes(32)
        self.cookie_name = cookie_name

    def sign(self, value: str) -> str:
        return hmac.new(self.key, value.encode("ascii"), hashlib.sha256).hexdigest()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        cookie = Request(scope).cookies.get(self.cookie_name, "")
        value, _, signature = cookie.partition(".")
        valid = (len(value) == 43 and value.isascii() and len(signature) == 64 and signature.isascii()
                 and hmac.compare_digest(signature, self.sign(value)))
        if not valid:
            value = secrets.token_urlsafe(32)
        scope.setdefault("state", {})["guest_id"] = value

        async def session_send(message):
            if message["type"] == "http.response.start" and not valid:
                response = Response()
                response.set_cookie(self.cookie_name, value + "." + self.sign(value),
                                    httponly=True, secure=self.secure, samesite="lax", path="/")
                message = {**message, "headers": [*message.get("headers", []),
                           *[(k, v) for k, v in response.raw_headers if k == b"set-cookie"]]}
            await send(message)

        await self.app(scope, receive, session_send)

"""Single-origin pilot boundary and a deliberately narrow production file server."""
from __future__ import annotations

import ipaddress
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.datastructures import Headers


class PilotBoundary:
    """Raw ASGI: forward every streaming frame immediately, without buffering."""

    def __init__(self, app, origin: str):
        self.app = app
        self.origin = origin
        self.host = origin.removeprefix("https://")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        host_values = headers.getlist("host")
        host = host_values[0] if len(host_values) == 1 else ""
        local_hosts = {"localhost:8788", "127.0.0.1:8788"}
        try:
            local_peer = bool(scope.get("client") and ipaddress.ip_address(scope["client"][0]).is_loopback)
        except ValueError:
            local_peer = False
        if not local_peer or host not in {self.host, *local_hosts}:
            return await JSONResponse({"detail": "invalid pilot host or peer"}, status_code=400)(scope, receive, send)
        expected_origin = self.origin if host == self.host else "http://" + host
        origins = headers.getlist("origin")
        referer = headers.get("referer", "")
        unsafe = scope["method"] not in {"GET", "HEAD", "OPTIONS"}
        # Reject cross-origin reads too; absent Origin on same-origin GET is normal.
        if ((origins and origins != [expected_origin]) or
                (unsafe and not origins and not referer.startswith(expected_origin + "/")) or
                headers.get("sec-fetch-site") == "cross-site"):
            return await JSONResponse({"detail": "invalid pilot origin"}, status_code=403)(scope, receive, send)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                response_headers = [(k, v) for k, v in message.get("headers", [])
                                    if k.lower() != b"cache-control"]
                response_headers.extend([
                    (b"cache-control", b"no-store, no-transform"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"same-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                ])
                message = {**message, "headers": response_headers}
            await send(message)

        # Do not expose provider diagnostics/paths or probe providers for readiness.
        if scope["path"] == "/health":
            return await JSONResponse({"ok": True, "pilot": True})(scope, receive, secure_send)
        await self.app(scope, receive, secure_send)


def register_frontend(app, dist: Path) -> None:
    dist = dist.resolve()
    if not (dist / "index.html").is_file() or not (dist / "assets").is_dir():
        raise RuntimeError("Production frontend missing. Run npm run build before starting the pilot.")
    allowed_extensions = {".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".woff", ".woff2", ".glb", ".mp3"}

    @app.api_route("/{asset_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def frontend(asset_path: str, request: Request):
        # Hash routes never reach the server; no arbitrary path needs index fallback.
        if asset_path in {"", "index.html"}:
            return FileResponse(dist / "index.html")
        parts = asset_path.split("/")
        path = (dist / asset_path).resolve()
        if (any(part.startswith(".") or "\\" in part or ":" in part for part in parts)
                or not path.is_relative_to(dist) or not path.is_file()
                or not (asset_path == "medsim.mp3" or
                        (parts[0] == "assets" and path.suffix.lower() in allowed_extensions))):
            raise HTTPException(404, "not found")
        return FileResponse(path)

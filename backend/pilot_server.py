"""Windows/ngrok pilot: production SPA plus the existing APIs, on loopback only."""
from __future__ import annotations

import os
from pathlib import Path

from medsim_backend.config import load_env_local, load_runtime_settings

load_env_local()
if os.environ.get("MEDSIM_PILOT_MODE") != "1":
    raise RuntimeError("Use scripts/start-pilot.ps1 with an explicit HTTPS tunnel hostname")
load_runtime_settings()  # Fail closed before initializing the database/providers.

from server import app  # noqa: E402 - provider config must load before runtime imports
from medsim_backend.pilot import register_frontend  # noqa: E402

register_frontend(app, Path(__file__).resolve().parents[1] / "dist")

if __name__ == "__main__":
    import uvicorn

    # ngrok terminates HTTPS. Cookies are explicitly Secure; no forwarded header
    # is needed for authentication, origin checks, client identity or redirects.
    uvicorn.run(app, host="127.0.0.1", port=8788, proxy_headers=False,
                server_header=False, access_log=False, log_level="info")

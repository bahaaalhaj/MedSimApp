from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


def load_env_local() -> None:
    """Load backend/.env.local without overriding non-empty process values."""
    env_path = Path(__file__).resolve().parents[1] / ".env.local"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and not os.environ.get(key):
            os.environ[key] = value


@dataclass(frozen=True)
class RuntimeSettings:
    shared_secret: str
    allowed_origins: list[str]
    dev_origins: set[str]
    development_access: bool = False
    pilot_origin: str = ""


def pilot_origin(value: str) -> str:
    """Require one exact HTTPS DNS name; no wildcards, ports, paths or userinfo."""
    if not re.fullmatch(r"https://(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?", value):
        raise ValueError("Pilot origin must be https:// followed by the exact lowercase tunnel hostname")
    hostname = value.removeprefix("https://")
    if "." not in hostname or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in hostname.split(".")):
        raise ValueError("Invalid pilot hostname")
    return value


def load_runtime_settings() -> RuntimeSettings:
    pilot = os.environ.get("MEDSIM_PILOT_MODE") == "1"
    origin = pilot_origin(os.environ.get("MEDSIM_PILOT_ORIGIN", "")) if pilot else ""
    return RuntimeSettings(
        shared_secret=os.environ.get("BACKEND_SHARED_SECRET", ""),
        allowed_origins=[origin] if pilot else [
            "https://medsim.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
        ],
        dev_origins={
            "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
        },
        development_access=not pilot and os.environ.get("MEDSIM_ENVIRONMENT", "development").lower() == "development"
        and os.environ.get("RENDER", "").lower() != "true",
        pilot_origin=origin,
    )

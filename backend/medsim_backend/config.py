from __future__ import annotations

import os
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


def load_runtime_settings() -> RuntimeSettings:
    return RuntimeSettings(
        shared_secret=os.environ.get("BACKEND_SHARED_SECRET", ""),
        allowed_origins=[
            "https://medsim.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
        ],
        dev_origins={
            "http://localhost:5173", "http://127.0.0.1:5173",
            "http://localhost:5174", "http://127.0.0.1:5174",
        },
    )

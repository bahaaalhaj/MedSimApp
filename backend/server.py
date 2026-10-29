"""Backward-compatible MedSim FastAPI entry point.

Route registration and server-owned behavior live in ``medsim_backend``.
This module remains the supported startup target and preserves current imports.
"""

from medsim_backend.config import load_env_local

# Provider settings are captured on import. Load private configuration first for
# both the supported direct command and ASGI imports, not only runtime creation.
load_env_local()

from local_ai import LOCAL_AI_CASES  # noqa: E402 - private config must be loaded first.
from local_llm import get_local_llm_provider  # noqa: E402 - private config must be loaded first.
from medsim_backend.runtime import (  # noqa: E402 - private config must be loaded first.
    TTS_SETTINGS,
    _ATTEMPT_STORE,
    _ATTEMPT_TTL_SECONDS,
    _INVESTIGATION_ATTEMPTS,
    _INVESTIGATION_CASES,
    _INVESTIGATION_LOCK,
    _MAX_ACTIVE_ATTEMPTS_PER_OWNER,
    _SAFE_CURATED_CASES,
    app,
    auth_api,
    limiter,
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")

"""Non-secret OpenRouter readiness check; performs no completion request."""
from __future__ import annotations

import asyncio
import json

import server  # Loads backend/.env.local before provider initialization.
from local_llm import get_local_llm_provider, health_dict


async def main() -> int:
    health = health_dict(await get_local_llm_provider().health())
    safe = {
        "provider": health["provider"],
        "model": health["model"],
        "state": health["state"],
        "catalog_context_length": health["catalog_context_length"],
        "supports_structured_outputs": health["supports_structured_outputs"],
        "last_error_category": health["last_error_category"],
        "local_model_enabled": server.llm_settings().local_llm_enabled,
    }
    print(json.dumps(safe, indent=2))
    return 0 if health["state"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

"""Real loopback peers for development-mode HTTP tests, isolated per client."""
import secrets

from fastapi.testclient import TestClient as FastAPITestClient


class TestClient(FastAPITestClient):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("client", (f"127.{secrets.randbelow(254) + 1}.{secrets.randbelow(254) + 1}.{secrets.randbelow(254) + 1}", 50000))
        super().__init__(*args, **kwargs)

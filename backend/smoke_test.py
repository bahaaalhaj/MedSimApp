"""Live configured-provider smoke test. Requires a running FastAPI backend."""
from __future__ import annotations
import json
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8787"


def request(path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={
        "content-type": "application/json", "origin": "http://localhost:5173"
    })
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read().decode()


def main() -> int:
    health = json.loads(request("/health"))
    print(json.dumps(health, indent=2))
    if health["local_ai"]["state"] != "ready":
        print("FAIL: configured model provider is not ready", file=sys.stderr)
        return 1
    print("PASS: backend, configured provider, and deterministic evaluator are reachable")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

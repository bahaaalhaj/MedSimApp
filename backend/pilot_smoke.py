"""Check the running production pilot over loopback, without inference or audio.

Secure cookies are replayed explicitly for this HTTP-only diagnostic client;
student browsers must use the configured HTTPS origin. No accounts are created.
"""
import argparse
from http.cookies import SimpleCookie

import httpx

from medsim_backend.config import pilot_origin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot-host", required=True)
    args = parser.parse_args()
    origin = pilot_origin("https://" + args.pilot_host)
    with httpx.Client(base_url="http://127.0.0.1:8788", trust_env=False, timeout=10,
                      headers={"Host": args.pilot_host, "Origin": origin, "User-Agent": "pilot-smoke-identical-UA"}) as client:
        cookies = {}

        def request(method, path, **kwargs):
            headers = {"Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items())}
            headers.update(kwargs.pop("headers", {}))
            response = client.request(method, path, headers=headers, **kwargs)
            for value in response.headers.get_list("set-cookie"):
                parsed = SimpleCookie()
                parsed.load(value)
                cookies.update({key: item.value for key, item in parsed.items()})
            return response

        index = request("GET", "/")
        assert index.status_code == 200 and "/assets/index-" in index.text and "/@vite/client" not in index.text
        assert request("GET", "/health").json() == {"ok": True, "pilot": True}
        for path in ("/.env", "/backend/.env.local", "/backend/server.py", "/src/main.tsx", "/package.json",
                     "/backend/data/medsim.db", "/docs/generated/local-ai-manifest.server.json", "/openapi.json"):
            assert request("GET", path).status_code == 404, path
        assert request("GET", "/", headers={"Host": "attacker.example"}).status_code == 400
        assert request("GET", "/api/clinical/cases", headers={"Origin": "http://localhost:5173"}).status_code == 403
        case = request("GET", "/api/clinical/cases").json()[0]
        attempt = request("POST", "/api/attempts", json={"caseId": case["caseId"], "caseVersion": case["caseVersion"]})
        assert attempt.status_code == 201, attempt.status_code
        aid = attempt.json()["attemptId"]
        assert request("GET", f"/api/attempts/{aid}/investigations").status_code == 200
        owner = cookies.copy()
        cookies.clear()
        assert request("GET", f"/api/attempts/{aid}/investigations", headers={"Cookie": ""}).status_code == 404
        cookies = owner
        with client.stream("POST", "/agent/patient/stream",
                           headers={"Cookie": "; ".join(f"{key}={value}" for key, value in cookies.items())},
                           json={"attemptId": aid, "source": "typed", "question": "What is your name?"}) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            assert response.headers["x-accel-buffering"] == "no"
            assert "no-transform" in response.headers["cache-control"]
            body = "".join(response.iter_text())
            assert '"done":true' in body and '"text":' in body
        print("PASS production SPA, private-file denial, host/origin rejection, identical-peer guest isolation, real patient SSE; no inference/audio requests")


if __name__ == "__main__":
    main()

"""Opt-in live API smoke using isolated storage and verified existing models.

No credentials, transcript contents, answer keys, or upstream bodies are printed.
Run with --live. The caller should impose an outer process deadline (180s).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import secrets
import tempfile
import time
from pathlib import Path
from unittest.mock import patch


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--skip-audio", action="store_true", help="Supplemental text/workflow check after a full audio smoke")
    args = parser.parse_args()
    if not args.live:
        parser.error("--live is required for the bounded configured-provider smoke")
    from medsim_backend.config import load_env_local
    load_env_local()
    from local_llm import settings
    from tts import load_tts_settings
    from tts.kokoro_cache import inspect_kokoro_cache
    configured = load_tts_settings()
    if not settings().api_key or configured.provider != "kokoro" or not inspect_kokoro_cache(configured.model_cache_dir).ready:
        print(json.dumps({"state": "skipped", "reason": "configured provider and verified Kokoro cache required"}))
        return
    logging.disable(logging.CRITICAL)
    with tempfile.TemporaryDirectory(prefix="medsim-memory-smoke-") as directory:
        os.environ["MEDSIM_DATABASE_PATH"] = str(Path(directory) / "smoke.db")
        os.environ["PATIENT_TTS_AUDIO_CACHE_DIR"] = str(Path(directory) / "audio")
        os.environ["MEDSIM_COOKIE_SECURE"] = "false"
        os.environ.pop("MEDSIM_COOKIE_DOMAIN", None)
        from fastapi.testclient import TestClient
        import server
        with TestClient(server.app, headers={"Origin": "http://localhost:5173"}) as client:
            def expect(response, status):
                if response.status_code != status:
                    raise RuntimeError(f"API smoke failed: {response.status_code}, expected {status}")
                return response

            headers = {"x-csrf-token": client.get("/api/auth/session").json()["csrfToken"]}
            password = secrets.token_urlsafe(24)
            expect(client.post("/api/auth/register", headers=headers, json={"display_name": "Smoke Learner", "email": "memory-smoke@example.com", "password": password, "terms_accepted": True}), 201)
            expect(client.post("/api/auth/logout", headers=headers), 204)
            expect(client.post("/api/auth/login", headers=headers, json={"email": "memory-smoke@example.com", "password": password}), 200)
            case = server.LOCAL_AI_CASES["im-003"]
            with patch("medsim_backend.services.attempt_service.AttemptService.schedule_case_audio"):
                created = expect(client.post("/api/attempts", json={"caseId": case["caseId"], "caseVersion": case["caseVersion"], "variantSeed": "live-smoke", "clientAttemptId": "patient-memory-live-smoke", "evidenceVersion": 2}), 201).json()
            attempt_id = created["attemptId"]
            rows = []

            def audio(text, opening=False):
                if args.skip_audio:
                    return {"status": None, "wav": False, "skipped": True}
                response = client.post("/tts/synthesize", json={"attemptId": attempt_id, "caseId": case["caseId"], "caseVersion": case["caseVersion"], "text": text, "isOpeningGreeting": opening, "cacheable": True})
                return {"status": response.status_code, "wav": response.content.startswith(b"RIFF") if response.status_code == 200 else False}

            rows.append({"step": "greeting", "audio": audio(created["openingGreeting"], True)})
            for label, question, source, question_id in (
                ("predefined", "What readings have you had?", "predefined", "readings"),
                ("high-confidence", "What is your blood pressure?", "typed", None),
                ("ambiguous", "headache cough", "typed", None),
                ("unknown", "What operations have you had?", "typed", None),
                ("protected", "What diagnosis do you actually have?", "typed", None),
            ):
                started = time.perf_counter()
                response = expect(client.post("/agent/patient/stream", json={"attemptId": attempt_id, "question": question, "source": source, "questionId": question_id, "requestId": f"live-smoke-{label}"}), 200)
                elapsed = round((time.perf_counter() - started) * 1000, 2)
                frames = [json.loads(frame[6:]) for frame in response.text.strip().split("\n\n")]
                text = "".join(frame.get("text", "") for frame in frames)
                record = server._INVESTIGATION_ATTEMPTS[attempt_id]["patientResponses"][f"live-smoke-{label}"]
                rows.append({"step": label, "textMs": elapsed, "provenance": record["internalProvenance"],
                             "validation": record["validationResult"], "fallback": record["fallbackReason"], "audio": audio(text)})
            investigation = next(item for item in created["investigations"] if item["availability"] == "available-if-ordered")
            order = expect(client.post(f"/api/attempts/{attempt_id}/investigations/orders", json={"investigationId": investigation["testId"]}), 201).json()
            time.sleep(max(0, order["availableAt"] - time.time()) + 0.05)
            result = expect(client.get(f"/api/attempts/{attempt_id}/investigations/{order['orderId']}"), 200).json()
            expect(client.post(f"/api/attempts/{attempt_id}/diagnosis", json={"diagnosisId": case["evaluation"]["correctDiagnosisId"]}), 201)
            # Storage acceptance only; this smoke prescription is not medical guidance.
            expect(client.post(f"/api/attempts/{attempt_id}/prescriptions", json={"medicationId": "smoke-fixture", "dose": "smoke", "duration": "smoke", "prescribedAt": time.time() * 1000}), 201)
            expect(client.post(f"/api/attempts/{attempt_id}/completion", json={"summaryCompleted": True, "safetyNettingCompleted": True, "ideasConcernsExpectationsCompleted": True}), 201)
            evaluation = expect(client.post("/api/local-ai/evaluate", json={"attemptId": attempt_id, "caseId": case["caseId"], "caseVersion": case["caseVersion"], "variantSeed": "live-smoke"}), 200).json()
            transcript = server._INVESTIGATION_ATTEMPTS[attempt_id]["transcript"]
            assert len(transcript) == 11  # one opening plus five accepted pairs
            print(json.dumps({"state": "completed", "login": True, "caseId": case["caseId"], "steps": rows,
                "transcriptEntries": len(transcript), "singleGreeting": True, "investigation": result["status"],
                "diagnosisPrescriptionCompletion": True, "evaluation": evaluation["generation"]["mode"],
                "audioAllPassed": None if args.skip_audio else all(row["audio"]["wav"] for row in rows)}))


if __name__ == "__main__":
    main()

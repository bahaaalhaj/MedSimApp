from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path

from fastapi.testclient import TestClient


_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import server


class BackendRouteContractTests(unittest.TestCase):
    """Characterize the public FastAPI contract before route extraction.

    This intentionally asserts route paths, methods, declared success status
    codes, and request field names rather than implementation details. Existing
    endpoint tests cover the authentication, ownership, SSE, evaluation, and
    TTS behavior behind these contracts.
    """

    def test_public_route_methods_and_declared_success_statuses_are_stable(self) -> None:
        schema = server.app.openapi()
        expected = {
            "/agent/patient/stream": {"post": "200"},
            "/api/attempts": {"post": "201"},
            "/api/attempts/{attempt_id}/completion": {"post": "201"},
            "/api/attempts/{attempt_id}/diagnosis": {"post": "201"},
            "/api/attempts/{attempt_id}/examinations": {"post": "201"},
            "/api/attempts/{attempt_id}/investigations": {"get": "200"},
            "/api/attempts/{attempt_id}/investigations/orders": {"post": "201"},
            "/api/attempts/{attempt_id}/investigations/{order_id}": {"get": "200"},
            "/api/attempts/{attempt_id}/prescriptions": {"post": "201"},
            "/api/auth/login": {"post": "200"},
            "/api/auth/logout": {"post": "204"},
            "/api/auth/me": {"get": "200"},
            "/api/auth/register": {"post": "201"},
            "/api/auth/session": {"get": "200"},
            "/api/clinical/cases": {"get": "200"},
            "/api/clinical/cases/{case_id}": {"get": "200"},
            "/api/local-ai/evaluate": {"post": "200"},
            "/api/progress/encounters": {"get": "200", "post": "201"},
            "/api/progress/encounters/{encounter_id}": {"get": "200", "delete": "204"},
            "/health": {"get": "200"},
            "/tts/synthesize": {"post": "200"},
        }
        actual = {
            path: {
                method: next(code for code in operation["responses"] if code != "422")
                for method, operation in operations.items()
            }
            for path, operations in schema["paths"].items()
        }
        self.assertEqual(actual, expected)

    def test_backend_owned_request_field_names_are_stable(self) -> None:
        schemas = server.app.openapi()["components"]["schemas"]
        expected = {
            "CreateClinicalAttemptRequest": {"caseId", "caseVersion", "variantSeed", "clientAttemptId", "patientProfile", "evidenceVersion"},
            "InvestigationOrderRequest": {"investigationId", "indication"},
            "AttemptExaminationRequest": {"actionId", "performedAt"},
            "AttemptDiagnosisRequest": {"diagnosisId"},
            "AttemptPrescriptionRequest": {"medicationId", "dose", "duration", "prescribedAt"},
            "AttemptCompletionRequest": {"summaryCompleted", "safetyNettingCompleted", "ideasConcernsExpectationsCompleted"},
            "PatientTurnRequest": {"attemptId", "question", "source", "questionId", "requestId"},
            "EvaluationRequest": {"attemptId", "caseId", "caseVersion", "variantSeed", "askedQuestionIds", "treatmentIds", "prescriptions", "submittedDiagnosisId", "transcript", "examinations", "completionChecks"},
            "PatientTTSRequestBody": {"text", "attemptId", "caseId", "gender", "isPediatric", "speed", "language", "caseVersion", "isOpeningGreeting", "cacheable", "requestId"},
        }
        self.assertEqual(
            {name: set(schemas[name]["properties"]) for name in expected},
            expected,
        )

    def test_public_routes_are_registered_exactly_once(self) -> None:
        public_routes = [
            (route.path, method)
            for route in server.app.routes
            if hasattr(route, "methods")
            for method in route.methods
            if method not in {"HEAD", "OPTIONS"} and route.path not in {"/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"}
        ]
        duplicates = {
            f"{method} {path}": count
            for (path, method), count in Counter(public_routes).items()
            if count != 1
        }
        self.assertEqual(duplicates, {})

    def test_health_response_field_names_are_stable(self) -> None:
        with TestClient(server.app) as client:
            response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {
            "ok", "patient_tts", "local_ai", "evaluation_mode", "patient_ready",
            "evaluator_ready", "last_safe_error_category",
        })


if __name__ == "__main__":
    unittest.main()

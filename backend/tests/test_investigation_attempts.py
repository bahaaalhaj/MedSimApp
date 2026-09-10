from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import server


class InvestigationAttemptApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"Origin": "http://localhost:5173", "User-Agent": "medsim-investigation-test"}
        safe_case = self.client.get("/api/clinical/cases", headers=self.headers).json()[0]
        response = self.client.post(
            "/api/attempts",
            headers=self.headers,
            json={"caseId": safe_case["caseId"], "caseVersion": safe_case["caseVersion"]},
        )
        self.assertEqual(response.status_code, 201)
        self.attempt = response.json()

    def tearDown(self):
        self.client.close()

    def test_catalogue_does_not_leak_result_fields(self):
        forbidden = {"result", "structuredResult", "abnormal", "postSubmissionExplanation", "supportsDiagnosisIds"}
        self.assertTrue(self.attempt["investigations"])
        for item in self.attempt["investigations"]:
            self.assertTrue(forbidden.isdisjoint(item))

    def test_only_ordered_result_is_retrievable_and_snapshot_is_immutable(self):
        investigation_id = self.attempt["investigations"][0]["testId"]
        ordered = self.client.post(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/orders",
            headers=self.headers,
            json={"investigationId": investigation_id, "indication": "Test indication"},
        )
        self.assertEqual(ordered.status_code, 201)
        order = ordered.json()
        self.assertNotIn("resultSnapshot", order)
        server._INVESTIGATION_ATTEMPTS[self.attempt["attemptId"]]["orders"][order["orderId"]]["availableAt"] = 0
        result = self.client.get(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/{order['orderId']}", headers=self.headers
        )
        self.assertEqual(result.status_code, 200)
        snapshot = copy.deepcopy(result.json()["resultSnapshot"])
        duplicate = self.client.post(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/orders",
            headers=self.headers,
            json={"investigationId": investigation_id, "indication": "Changed indication"},
        )
        self.assertEqual(duplicate.json()["orderId"], order["orderId"])
        again = self.client.get(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/{order['orderId']}", headers=self.headers
        ).json()["resultSnapshot"]
        self.assertEqual(again, snapshot)

    def test_cross_attempt_and_unknown_ids_fail_closed(self):
        other = self.client.post(
            "/api/attempts", headers=self.headers,
            json={"caseId": self.attempt["caseId"], "caseVersion": self.attempt["caseVersion"]},
        ).json()
        investigation_id = self.attempt["investigations"][0]["testId"]
        order = self.client.post(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/orders", headers=self.headers,
            json={"investigationId": investigation_id},
        ).json()
        response = self.client.get(
            f"/api/attempts/{other['attemptId']}/investigations/{order['orderId']}", headers=self.headers
        )
        self.assertEqual(response.status_code, 404)
        unknown = self.client.post(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/orders", headers=self.headers,
            json={"investigationId": "not-a-real-investigation"},
        )
        self.assertEqual(unknown.status_code, 404)

    def test_guest_owner_binding_and_predictable_test_id_cannot_bypass_order(self):
        investigation_id = self.attempt["investigations"][0]["testId"]
        guessed = self.client.get(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/{investigation_id}", headers=self.headers
        )
        self.assertEqual(guessed.status_code, 404)
        other_browser = {**self.headers, "User-Agent": "different-browser"}
        denied = self.client.get(
            f"/api/attempts/{self.attempt['attemptId']}/investigations", headers=other_browser
        )
        self.assertEqual(denied.status_code, 404)

    def test_conditional_order_requires_a_documented_indication(self):
        conditional = next((item for item in self.attempt["investigations"] if item["availability"] == "conditional"), None)
        self.assertIsNotNone(conditional)
        without = self.client.post(
            f"/api/attempts/{self.attempt['attemptId']}/investigations/orders", headers=self.headers,
            json={"investigationId": conditional["testId"], "indication": ""},
        )
        self.assertEqual(without.status_code, 201)
        self.assertEqual(without.json()["status"], "unavailable")

    def test_wrong_case_version_is_rejected(self):
        response = self.client.post(
            "/api/attempts", headers=self.headers,
            json={"caseId": self.attempt["caseId"], "caseVersion": "wrong"},
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

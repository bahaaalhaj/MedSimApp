from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import server


class ClinicalCaseApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app)
        self.headers = {"Origin": "http://localhost:5173"}

    def tearDown(self):
        self.client.close()
        os.environ.pop("MEDSIM_ENABLE_DEVELOPMENT_CASES", None)

    def test_curated_mode_excludes_unapproved_cases(self):
        response = self.client.get("/api/clinical/cases", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_development_summary_never_exposes_ground_truth(self):
        os.environ["MEDSIM_ENABLE_DEVELOPMENT_CASES"] = "true"
        response = self.client.get("/api/clinical/cases?mode=development", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 3)
        forbidden = {"correctDiagnosisId", "correctDiagnosis", "rubric", "criticalTreatmentIds", "medicationExpectations", "testResults"}
        for case in response.json():
            self.assertTrue(forbidden.isdisjoint(case.keys()))

    def test_draft_case_id_cannot_bypass_curated_mode(self):
        response = self.client.get("/api/clinical/cases/im-003", headers=self.headers)
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

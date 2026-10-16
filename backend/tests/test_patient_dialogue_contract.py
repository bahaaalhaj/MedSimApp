"""Frozen dialogue contracts: no network inference or model loading."""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient
import server
from local_ai import compose_patient_answer, exact_patient_answer, opening_greeting


class PatientDialogueContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(server.app, headers={"Origin": "http://localhost:5173"})
        self.case = server.LOCAL_AI_CASES["allergy-001"]
        self.profile = self.case["patient"]
        with patch("medsim_backend.services.attempt_service.AttemptService.schedule_case_audio"):
            response = self.client.post("/api/attempts", json={
                "caseId": self.case["caseId"], "caseVersion": self.case["caseVersion"],
                "variantSeed": "dialogue-contract", "clientAttemptId": "dialogue-contract-request",
            })
        self.assertEqual(response.status_code, 201)
        self.attempt_id = response.json()["attemptId"]

    def tearDown(self):
        server._INVESTIGATION_ATTEMPTS.pop(self.attempt_id, None)

    def test_all_predefined_values_remain_exact_canonical_projection(self):
        self.assertEqual(len(server.LOCAL_AI_CASES), 72)
        for case in server.LOCAL_AI_CASES.values():
            for row in case["patient"]["history"]:
                self.assertEqual(exact_patient_answer(case, row["id"]), row["answer"] if row.get("predefined", True) else None)

    def test_sse_terminal_order_metadata_and_idempotent_transcript(self):
        body = {"attemptId": self.attempt_id, "source": "predefined", "questionId": "season",
                "question": "Seasonal?", "requestId": "dialogue-contract-turn"}
        with patch("medsim_backend.services.patient_dialogue_service.get_local_llm_provider") as provider:
            first = self.client.post("/agent/patient/stream", json=body)
            second = self.client.post("/agent/patient/stream", json=body)
        provider.assert_not_called()
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.headers["content-type"].startswith("text/event-stream"))
        self.assertEqual(first.text, second.text)
        frames = [json.loads(frame[6:]) for frame in first.text.strip().split("\n\n")]
        self.assertTrue(frames[-1]["done"])
        self.assertTrue(all("text" in frame and "done" not in frame for frame in frames[:-1]))
        self.assertEqual("".join(frame["text"] for frame in frames[:-1]), "It usually happens during spring.")
        self.assertEqual(frames[-1]["answerShownToTrainee"], "Spring.")
        attempt = server._INVESTIGATION_ATTEMPTS[self.attempt_id]
        self.assertEqual(len(attempt["transcript"]), 3)  # opening greeting, question, answer
        self.assertEqual(attempt["transcript"][0]["content"], opening_greeting(self.profile))
        self.assertEqual(len(attempt["patientMessages"]), 2)
        self.assertEqual(attempt["askedQuestionIds"], ["season"])
        self.assertFalse(attempt["patientRequestActive"])

    def test_frontend_cannot_control_retrieval_or_provider(self):
        for key in ("model", "system", "patientMemory", "retrievalFilters", "caseTruth"):
            response = self.client.post("/agent/patient/stream", json={
                "attemptId": self.attempt_id, "question": "Hello", "source": "typed", key: {},
            })
            self.assertEqual(response.status_code, 422)

    def test_ownership_and_question_source_validation(self):
        stranger = TestClient(server.app, headers={"Origin": "http://localhost:5173", "User-Agent": "stranger"})
        payload = {"attemptId": self.attempt_id, "question": "Seasonal?", "source": "typed"}
        self.assertEqual(stranger.post("/agent/patient/stream", json=payload).status_code, 404)
        self.assertEqual(self.client.post("/agent/patient/stream", json={**payload, "questionId": "season"}).status_code, 422)

    def test_composer_and_greeting_do_not_mutate_sources(self):
        before = copy.deepcopy(server.LOCAL_AI_CASES)
        self.assertEqual(opening_greeting(self.profile), "Hello, doctor. I came in because every spring I sneeze nonstop with itchy eyes.")
        for case in server.LOCAL_AI_CASES.values():
            for row in case["patient"]["history"]:
                self.assertTrue(compose_patient_answer(row["answer"], row["question"], is_parent=case["patient"]["age"] < 14))
        self.assertEqual(before, server.LOCAL_AI_CASES)

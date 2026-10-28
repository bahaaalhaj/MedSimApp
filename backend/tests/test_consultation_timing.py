"""Client-observed elapsed time is descriptive evidence, never scoring truth."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from test_support import TestClient
from medsim_backend.services import evaluation_service


class ConsultationTimingTests(unittest.TestCase):
    def setUp(self):
        server.limiter.reset()
        self.addCleanup(server.limiter.reset)
        self.client = TestClient(server.app, headers={'Origin': 'http://localhost:5173', 'User-Agent': 'timing-owner'})
        self.case = server.LOCAL_AI_CASES['id-004']
        response = self.client.post('/api/attempts', json={'caseId': 'id-004', 'caseVersion': self.case['caseVersion']})
        self.aid = response.json()['attemptId']
        self.addCleanup(server._INVESTIGATION_ATTEMPTS.pop, self.aid, None)
        self.payload = {'attemptId': self.aid, 'caseId': 'id-004', 'caseVersion': self.case['caseVersion']}
        provider = AsyncMock()
        provider.health.side_effect = TimeoutError()
        patcher = patch.object(evaluation_service, 'get_local_llm_provider', return_value=provider)
        patcher.start()
        self.addCleanup(patcher.stop)

    def evaluate(self, timing=None):
        payload = copy.deepcopy(self.payload)
        if timing is not None:
            payload['encounterTiming'] = timing
        return self.client.post('/api/local-ai/evaluate', json=payload)

    def test_minutes_are_derived_and_no_target_or_time_score_is_invented(self):
        response = self.evaluate({'startedAtMs': 1000, 'finishedAtMs': 121000})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['consultation_timing'], {
            'elapsed_ms': 120000, 'elapsed_minutes': 2, 'source': 'client-observed', 'scored': False,
        })

    def test_longer_than_eight_minutes_does_not_fail_or_change_clinical_scoring(self):
        baseline = self.evaluate().json()
        server._INVESTIGATION_ATTEMPTS[self.aid]['evaluationResult'] = None
        result = self.evaluate({'startedAtMs': 1000, 'finishedAtMs': 901000}).json()
        self.assertEqual(result['consultation_timing']['elapsed_minutes'], 15)
        for key in ('domain_scores', 'global_rating', 'criteria', 'safety_breach'):
            self.assertEqual(result.get(key), baseline.get(key))

    def test_retries_cannot_rewrite_saved_timing_or_include_debrief_wait(self):
        first = self.evaluate({'startedAtMs': 1000, 'finishedAtMs': 301000}).json()
        second = self.evaluate({'startedAtMs': 1000, 'finishedAtMs': 99999999}).json()
        self.assertEqual(first, second)
        self.assertEqual(second['consultation_timing']['elapsed_minutes'], 5)

    def test_legacy_requests_do_not_gain_a_fabricated_zero_duration(self):
        response = self.evaluate()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('consultation_timing', response.json())

    def test_invalid_or_reversed_or_forged_extra_timing_fields_are_rejected(self):
        for timing in (
            {'startedAtMs': 2000, 'finishedAtMs': 1000},
            {'startedAtMs': -1, 'finishedAtMs': 1000},
            {'startedAtMs': 1000},
            {'startedAtMs': 1000, 'finishedAtMs': 2000, 'scored': True},
            {'startedAtMs': 'yesterday', 'finishedAtMs': 2000},
            {'startedAtMs': True, 'finishedAtMs': 2000},
        ):
            with self.subTest(timing=timing):
                self.assertEqual(self.evaluate(timing).status_code, 422)
        self.assertIsNone(server._INVESTIGATION_ATTEMPTS[self.aid]['evaluationResult'])

    def test_timing_is_attempt_owned_and_cannot_bypass_provenance(self):
        timing = {'startedAtMs': 1000, 'finishedAtMs': 121000}
        stranger = TestClient(server.app, headers=dict(self.client.headers))
        self.addCleanup(stranger.close)
        response = stranger.post('/api/local-ai/evaluate', headers={'User-Agent': 'different-owner'},
                                    json={**self.payload, 'encounterTiming': timing})
        self.assertEqual(response.status_code, 404)
        response = self.client.post('/api/local-ai/evaluate', json={**self.payload, 'caseId': 'im-002', 'encounterTiming': timing})
        self.assertEqual(response.status_code, 409)

    def test_nonfinite_timestamps_are_rejected_before_evaluation(self):
        from pydantic import ValidationError
        from medsim_backend.schemas import EvaluationRequest
        for value in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                EvaluationRequest(**self.payload, encounterTiming={'startedAtMs': 1000, 'finishedAtMs': value})

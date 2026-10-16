"""Conservative formative observations, not a new clinically validated rubric."""
import copy
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from medsim_backend.consultation_management import assess_consultation_management


def fixture():
    case = {'caseId': 'fixture', 'caseVersion': '1', 'patient': {'history': [
        {'id': 'focused', 'relevant': True, 'scoreable': True},
        {'id': 'context', 'relevant': False, 'scoreable': True},
        {'id': 'draft', 'relevant': True, 'scoreable': False, 'reviewStatus': 'pending-clinical-review'},
    ]}, 'evaluation': {'correctDiagnosisId': 'correct', 'rubric': [
        {'criterionId': 'dx', 'sourceDomain': 'diagnosis'},
        {'criterionId': 'tests', 'sourceDomain': 'investigation'},
    ]}}
    investigations = {'investigations': [{'testId': 'essential', 'role': 'essential'}, {'testId': 'harmful', 'role': 'harmful'}]}
    attempt = {'evidenceVersion': 2, 'transcript': [], 'diagnosisSubmittedAt': 20, 'submittedDiagnosisId': 'correct',
               'orders': {'order': {'investigationId': 'essential', 'orderedAt': 10, 'releasedAt': 15}},
               'completionChecks': {'summaryCompleted': True, 'safetyNettingCompleted': True, 'ideasConcernsExpectationsCompleted': True}}
    result = {'criteria': [{'criterion_id': 'dx', 'verdict': 'met'}, {'criterion_id': 'tests', 'verdict': 'met'}], 'safety_breach': None}
    return case, investigations, attempt, result


def turn(attempt, question, ids=('focused',), *, provenance='deterministic-authored', version='1'):
    attempt['transcript'].extend([
        {'role': 'trainee', 'content': question},
        {'role': 'patient', 'content': 'Synthetic authored answer.', 'dialogueProvenance': {
            'caseId': 'fixture', 'caseVersion': version, 'internalProvenance': provenance,
            'matchedFactIds': ['history:' + value for value in ids],
        }},
    ])


class ManagementObservationTests(unittest.TestCase):
    def assess(self, values):
        return assess_consultation_management(*values)

    def indicator(self, values, identifier):
        return next(row for row in self.assess(values)['indicators'] if row['id'] == identifier)

    def test_four_indicators_use_recorded_evidence_and_no_numeric_weight(self):
        values = fixture()
        turn(values[2], 'A focused history question?')
        report = self.assess(values)
        self.assertEqual(report['overall'], 'documented')
        self.assertFalse(report['affects_clinical_score'])
        self.assertEqual(report['time_policy'], 'context-only')
        self.assertEqual(len(report['indicators']), 4)
        self.assertTrue(all(row['status'] == 'documented' for row in report['indicators']))
        self.assertNotIn('score', report)

    def test_unknown_legacy_or_semantic_turns_are_not_automatic_history_evidence(self):
        for provenance, ids, version in [('openrouter-interpreted', ('focused',), '1'),
                                         ('deterministic-authored', ('draft',), '1'),
                                         ('deterministic-authored', ('not-a-source',), '1'),
                                         ('deterministic-authored', ('focused',), 'other-version')]:
            values = fixture()
            turn(values[2], 'A question?', ids, provenance=provenance, version=version)
            self.assertEqual(self.indicator(values, 'focused-questioning')['status'], 'not-assessable')
        values = fixture()
        turn(values[2], 'A question?')
        values[2]['evidenceVersion'] = 1
        self.assertEqual(self.indicator(values, 'focused-questioning')['status'], 'not-assessable')

    def test_only_authored_relevance_is_used_and_not_inferred_from_question_wording(self):
        values = fixture()
        turn(values[2], 'Unusual wording does not change authored relevance.', ('context',))
        self.assertEqual(self.indicator(values, 'focused-questioning')['status'], 'review-recommended')
        turn(values[2], 'Another focused question.', ('focused',))
        indicator = self.indicator(values, 'focused-questioning')
        self.assertEqual(indicator['status'], 'documented')
        self.assertEqual(indicator['counts']['relevant_sources'], 1)
        self.assertEqual(indicator['counts']['other_sources'], 1)

    def test_repetition_is_a_review_signal_not_a_penalty_and_new_information_is_not_repetition(self):
        values = fixture()
        turn(values[2], 'When did this begin?')
        turn(values[2], 'WHEN did this begin?!')
        repeated = self.indicator(values, 'repetition-review')
        self.assertEqual(repeated['status'], 'review-recommended')
        self.assertEqual(repeated['counts']['possible_repeats'], 1)
        self.assertIn('confirmation', repeated['evidence'].lower())
        turn(values[2], 'When did this begin?', ('focused', 'context'))
        self.assertEqual(self.indicator(values, 'repetition-review')['counts']['possible_repeats'], 1)

    def test_operational_failures_and_response_replay_do_not_become_repeated_questions(self):
        values = fixture()
        turn(values[2], 'When did this begin?')
        before = self.assess(values)
        values[2]['patientFailures'] = {'failed': {'category': 'rate-limited'}}
        values[2]['patientResponses'] = {'replay': {'text': 'ignored replay cache'}}
        self.assertEqual(self.assess(values), before)

    def test_mixed_pending_sources_do_not_become_false_repeats_or_promote_review(self):
        values = fixture()
        turn(values[2], 'A focused question?')
        turn(values[2], 'A focused question?', ('focused', 'draft'))
        self.assertEqual(self.indicator(values, 'repetition-review')['counts']['possible_repeats'], 0)
        values[0]['patient']['history'][-1]['scoreable'] = True
        self.assertEqual(self.indicator(values, 'focused-questioning')['counts']['relevant_sources'], 1)

    def test_prioritisation_uses_server_event_order_not_elapsed_time_or_inferred_reading(self):
        values = fixture()
        row = self.indicator(values, 'priority-sequencing')
        self.assertEqual(row['status'], 'documented')
        self.assertIn('not proof', row['evidence'].lower())
        values[2]['orders']['order']['releasedAt'] = 25
        self.assertEqual(self.indicator(values, 'priority-sequencing')['status'], 'review-recommended')
        values[2].pop('diagnosisSubmittedAt')
        self.assertEqual(self.indicator(values, 'priority-sequencing')['status'], 'not-assessable')

    def test_harmful_orders_and_missing_completion_or_safety_are_visible_even_if_fast(self):
        values = fixture()
        values[2]['orders']['harmful-order'] = {'investigationId': 'harmful', 'orderedAt': 10, 'releasedAt': 15}
        self.assertEqual(self.indicator(values, 'priority-sequencing')['status'], 'review-recommended')
        values[2]['completionChecks']['safetyNettingCompleted'] = False
        self.assertEqual(self.indicator(values, 'plan-and-safety')['status'], 'review-recommended')
        values[2]['completionChecks']['safetyNettingCompleted'] = True
        values[3]['safety_breach'] = {'what': 'Synthetic critical failure'}
        self.assertEqual(self.indicator(values, 'plan-and-safety')['status'], 'review-recommended')

    def test_duration_cannot_change_observations_and_inputs_are_immutable(self):
        values = fixture()
        turn(values[2], 'A focused question?')
        before = copy.deepcopy(values)
        report = self.assess(values)
        self.assertEqual(values, before)
        for minutes in (0, 2, 5, 20, 120):
            values[2]['encounterTiming'] = {'elapsed_minutes': minutes}
            self.assertEqual(self.assess(values), report)

    def test_report_has_no_raw_questions_answers_diagnosis_or_reference_truth(self):
        values = fixture()
        turn(values[2], 'PRIVATE QUESTION SHOULD NOT BE COPIED')
        text = json.dumps(self.assess(values))
        self.assertNotIn('PRIVATE QUESTION', text)
        self.assertNotIn('Synthetic authored answer', text)
        self.assertNotIn('correctDiagnosisId', text)

    def test_all_72_cases_have_a_bounded_report_without_promoting_pending_review(self):
        import server
        for case_id, case in server.LOCAL_AI_CASES.items():
            with self.subTest(case=case_id):
                values = fixture()
                report = assess_consultation_management(case, server._INVESTIGATION_CASES[case_id], values[2], values[3])
                self.assertEqual(len(report['indicators']), 4)
                self.assertFalse(report['affects_clinical_score'])


class ManagementEndpointTests(unittest.TestCase):
    def setUp(self):
        import server
        self.server = server
        server.limiter.reset()
        self.addCleanup(server.limiter.reset)
        from fastapi.testclient import TestClient
        self.client = TestClient(server.app, headers={'Origin': 'http://localhost:5173', 'User-Agent': 'management-owner'})
        case = server.LOCAL_AI_CASES['id-004']
        created = self.client.post('/api/attempts', json={'caseId': 'id-004', 'caseVersion': case['caseVersion'], 'evidenceVersion': 2})
        self.aid = created.json()['attemptId']
        self.addCleanup(server._INVESTIGATION_ATTEMPTS.pop, self.aid, None)
        self.payload = {'attemptId': self.aid, 'caseId': 'id-004', 'caseVersion': case['caseVersion']}
        self.provider = AsyncMock()
        self.provider.health.side_effect = TimeoutError()
        patcher = patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=self.provider)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_endpoint_attaches_formative_report_without_extra_model_calls_and_replays_it(self):
        response = self.client.post('/api/local-ai/evaluate', json=self.payload)
        self.assertEqual(response.status_code, 200)
        report = response.json()['consultation_management']
        self.assertFalse(report['affects_clinical_score'])
        self.assertEqual(len(report['indicators']), 4)
        self.assertEqual(self.provider.health.await_count, 1)
        self.provider.structured_completion.assert_not_awaited()
        self.assertEqual(self.client.post('/api/local-ai/evaluate', json=self.payload).json(), response.json())

    def test_first_server_diagnosis_event_is_recorded_once_and_replay_does_not_retime(self):
        case = self.server.LOCAL_AI_CASES['id-004']
        diagnosis = case['evaluation']['diagnosisOptionIds'][0]
        observed_at = self.server._INVESTIGATION_ATTEMPTS[self.aid]['createdAt'] + 1
        with patch('medsim_backend.services.attempt_service.time.time', return_value=observed_at):
            first = self.client.post(f'/api/attempts/{self.aid}/diagnosis', json={'diagnosisId': diagnosis})
        attempt = self.server._INVESTIGATION_ATTEMPTS[self.aid]
        self.assertEqual(first.status_code, 201)
        self.assertEqual(attempt['diagnosisSubmittedAt'], observed_at)
        with patch('medsim_backend.services.attempt_service.time.time', return_value=observed_at + 1):
            second = self.client.post(f'/api/attempts/{self.aid}/diagnosis', json={'diagnosisId': diagnosis})
        self.assertEqual(first.json(), second.json())
        self.assertEqual(attempt['diagnosisSubmittedAt'], observed_at)

    def test_another_owner_cannot_get_report_and_client_cannot_supply_its_verdict(self):
        response = self.client.post('/api/local-ai/evaluate', headers={'User-Agent': 'other-owner'}, json=self.payload)
        self.assertEqual(response.status_code, 404)
        response = self.client.post('/api/local-ai/evaluate', json={**self.payload, 'consultation_management': {'overall': 'documented'}})
        self.assertEqual(response.status_code, 422)

    def test_original_scores_safety_and_narrative_are_not_changed_by_observation_report(self):
        from local_ai import normalize_evaluation
        original = {}
        def capture(*args):
            result = normalize_evaluation(*args)
            original.update(copy.deepcopy(result))
            return result
        with patch('medsim_backend.services.evaluation_service.normalize_evaluation', side_effect=capture):
            response = self.client.post('/api/local-ai/evaluate', json=self.payload)
        self.assertEqual(response.status_code, 200)
        for key in ('global_rating', 'domain_scores', 'criteria', 'safety_breach', 'highlights', 'improvements', 'narrative'):
            self.assertEqual(response.json()[key], original[key])

    def test_observation_snapshot_does_not_change_during_provider_wait(self):
        async def unavailable():
            self.server._INVESTIGATION_ATTEMPTS[self.aid]['completionChecks'] = {
                'summaryCompleted': True, 'safetyNettingCompleted': True, 'ideasConcernsExpectationsCompleted': True}
            raise TimeoutError()
        self.provider.health.side_effect = unavailable
        response = self.client.post('/api/local-ai/evaluate', json=self.payload)
        row = next(item for item in response.json()['consultation_management']['indicators'] if item['id'] == 'plan-and-safety')
        # Existing critical safety failures remain visible even without completion checks.
        self.assertEqual(row['status'], 'review-recommended')
        self.assertEqual(row['counts']['completion_checks'], 0)

"""New-attempt scope, normalized bands, and unchanged historical assessment."""
import copy
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from local_ai import LOCAL_AI_CASES, normalize_evaluation
from medsim_backend.grading_policy import EXAMINATION_EXCLUDED, assessment_case
import test_pilot as fixtures


class AssessmentScopeTests(unittest.TestCase):
    def test_all_assignable_cases_keep_other_weights_and_original_rubrics(self):
        for original in LOCAL_AI_CASES.values():
            snapshot = copy.deepcopy(original)
            case, scope = assessment_case(original, EXAMINATION_EXCLUDED)
            rules = case['evaluation']['rubric']
            self.assertEqual(sum(row['weight'] for row in rules), 85)
            self.assertEqual(sum(row['weight'] for row in rules if row['domain'] == 'data_gathering'), 50)
            self.assertEqual(rules, [r for r in original['evaluation']['rubric'] if r['sourceDomain'] != 'examination'])
            self.assertEqual(scope['excluded_criteria'][0]['original_weight'], 15)
            self.assertEqual(original, snapshot)
            self.assertIs(assessment_case(original, None)[0], original)

    def test_bands_use_normalized_ratios_of_85_and_50(self):
        for maximum in (85, 50):
            for threshold, above, below in ((.85, 'excellent', 'good'), (.7, 'good', 'satisfactory'),
                                            (.55, 'satisfactory', 'borderline'), (.4, 'borderline', 'clear-fail')):
                for raw, expected in ((threshold * maximum, above), (threshold * maximum - .001, below)):
                    rules = [{'criterionId': key, 'sourceDomain': 'clinical-reasoning', 'domain': 'data_gathering',
                              'description': key, 'weight': weight, 'isCritical': False}
                             for key, weight in (('met', raw), ('missed', maximum - raw))]
                    case = {'caseId': 'threshold-fixture', 'patient': {'history': []},
                            'evaluation': {'correctDiagnosisId': 'fixture', 'rubric': rules}}
                    evidence = {'transcript': [{'content': 'Recorded synthetic evidence.'}]}
                    model = {'criteria': [{'criterion_id': 'met', 'verdict': 'met', 'evidence': 'Recorded synthetic evidence.'}]}
                    result = normalize_evaluation(case, evidence, [], model)
                    self.assertAlmostEqual(result['domain_scores']['data_gathering']['raw'], raw)
                    self.assertEqual(result['domain_scores']['data_gathering']['verdict'], expected)
                    self.assertEqual(result['global_rating'], expected)


class AssessmentScopeRoutes(unittest.TestCase):
    setUp = fixtures.PilotTests.setUp
    client = fixtures.PilotTests.client
    register = fixtures.PilotTests.register

    def create(self, client_id='examination-scope-client'):
        response = self.one.post('/api/attempts', json={'caseId': self.case['caseId'],
            'caseVersion': self.case['caseVersion'], 'clientAttemptId': client_id, 'evidenceVersion': 2})
        self.assertEqual(response.status_code, 201)
        return response.json()['attemptId']

    def evaluate(self, aid):
        provider = AsyncMock()
        provider.health.side_effect = TimeoutError()
        with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
            response = self.one.post('/api/local-ai/evaluate', json={'attemptId': aid,
                'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion']})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_new_attempt_never_fabricates_examination_or_penalizes_its_absence(self):
        aid = self.create()
        result = self.evaluate(aid)
        self.assertEqual(self.runtime.attempt_store.attempts[aid]['examinations'], [])
        self.assertEqual(sum(s['max'] for s in result['domain_scores'].values()), 85)
        self.assertEqual(result['domain_scores']['data_gathering']['max'], 50)
        self.assertEqual(result['assessment_scope']['policy'], EXAMINATION_EXCLUDED)
        self.assertEqual(len(result['criteria']), 5)
        self.assertFalse(any('examination' in row['evidence'].lower() for row in result['criteria']))
        self.assertTrue(result['safety_breach'], 'Existing critical safety failures still apply')
        spoofed = self.one.post('/api/attempts', json={'caseId': self.case['caseId'],
            'caseVersion': self.case['caseVersion'], 'gradingPolicy': 'legacy'})
        self.assertEqual(spoofed.status_code, 422)

    def test_legacy_attempt_retry_and_saved_history_keep_original_examination_credit(self):
        self.register(self.one, 'historical-scope@example.com')
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        attempt.pop('gradingPolicy')  # Simulate an attempt created before the policy existed.
        for action in ('general-observation', 'focused-examination'):
            self.assertEqual(self.one.post(f'/api/attempts/{aid}/examinations', json={'actionId': action, 'performedAt': 1000}).status_code, 201)
        self.assertEqual(self.create(), aid)
        self.assertNotIn('gradingPolicy', attempt)
        old = self.evaluate(aid)
        self.assertNotIn('assessment_scope', old)
        self.assertEqual(sum(s['max'] for s in old['domain_scores'].values()), 100)
        self.assertEqual(old['domain_scores']['data_gathering']['max'], 65)
        exam = next(row for row in old['criteria'] if row['criterion_id'].endswith('-r3'))
        self.assertEqual((exam['verdict'], exam['weight']), ('met', 15))
        snapshot = {'investigationAttemptId': aid, 'examinationActions': copy.deepcopy(attempt['examinations'])}
        saved = self.one.post('/api/progress/encounters', json={'caseId': self.case['caseId'], 'caseName': 'Historical fixture',
            'caseAge': 30, 'caseGender': 'F', 'diagnosisLabel': '', 'verdict': old['global_rating'],
            'evaluation': old, 'patientSnapshot': snapshot}).json()
        self.evaluate(self.create('new-examination-scope-client'))
        restored = self.one.get('/api/progress/encounters/' + saved['id']).json()
        self.assertEqual(restored['evaluation'], old)
        self.assertEqual(restored['patientSnapshot'], snapshot)
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').json()['examinations'], attempt['examinations'])

    def test_optional_model_receives_only_assessed_criteria_and_no_examination_penalty_instruction(self):
        aid = self.create()
        provider = AsyncMock()
        provider.health.return_value = SimpleNamespace(state='ready', safety_status='safe', provider='scripted', model='fixture')
        provider.structured_completion.return_value = SimpleNamespace(actual_model='fixture', value={
            'criteria': [], 'highlights': [], 'improvements': [], 'narrative': 'Synthetic recorded evidence only.',
        })
        with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
            result = self.one.post('/api/local-ai/evaluate', json={'attemptId': aid,
                'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion']})
        self.assertEqual(result.status_code, 200)
        prompt = provider.structured_completion.await_args.args[0]
        self.assertIn('Examination is Not assessed', prompt.system)
        self.assertNotIn('"sourceDomain":"examination"', prompt.user)
        self.assertEqual(sum(row['max'] for row in result.json()['domain_scores'].values()), 85)

"""Synthetic draft boundaries, scoring invariance, and real patient endpoint checks."""
import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import TestClient
import server
from local_ai import LOCAL_AI_CASES, SAFE_UNKNOWN_RESPONSE, _deterministic_assessment, exact_patient_answer, sanitize_patient_response
from patient_memory import compose_fact, derive_memory, retrieve, validate_grounded
from patient_memory_report import coverage_report

ROOT = Path(__file__).resolve().parents[2]

class HistoryDraftTests(unittest.TestCase):
    def test_446_approved_additions_have_attributed_review_without_invented_date_or_id(self):
        source = json.loads((ROOT / 'src/clinical/history-drafts.json').read_text(encoding='utf-8'))
        baseline = json.loads((ROOT / 'docs/development/history-draft-baseline.json').read_text())
        rows = source['additions']
        self.assertEqual(len(rows), 446)
        self.assertEqual(len({(r['caseId'], r['id']) for r in rows}), 446)
        self.assertEqual(source['reviewRecord']['reviewerName'], 'الدكتور محمد الأحمد')
        self.assertEqual(source['reviewRecord']['evidenceType'], 'project-owner-attestation')
        self.assertFalse(source['reviewRecord']['independentlyVerified'])
        for row in rows:
            self.assertEqual(row['reviewStatus'], 'clinician-approved')
            self.assertEqual(row['clinicianDecision'], 'approved')
            self.assertEqual(row['reviewerName'], 'الدكتور محمد الأحمد')
            self.assertIsNone(row['reviewerId'])
            self.assertIsNone(row['reviewedAt'])
            self.assertEqual(row['origin'], 'synthetic-authored-draft')
        review_keys = {'reviewStatus', 'clinicianDecision', 'reviewerId', 'reviewerName', 'reviewedAt', 'reviewEvidence'}
        facts = [{key: value for key, value in row.items() if key not in review_keys} for row in rows]
        self.assertEqual(hashlib.sha256(json.dumps(facts, sort_keys=True).encode()).hexdigest(),
                         '07abe40d00cb9e833a9ec71b7765b636d5db5560174b335b9efdc073dfbc95ec')
        for old in baseline['cases']:
            current = LOCAL_AI_CASES[old['caseId']]
            self.assertEqual(current['evaluation'], old['evaluation'])
            self.assertEqual([h for h in current['patient']['history'] if h.get('scoreable', True)], old['history'])
            self.assertEqual(len(current['patient']['history']), len({h['id'] for h in current['patient']['history']}))

    def test_coverage_and_approval_are_independent(self):
        report = coverage_report()
        self.assertEqual((report['caseCount'], report['authoredQuestionCount']), (72, 881))
        self.assertEqual(report['coreHistoryGapCount'], 0)
        self.assertEqual(report['pendingClinicalReviewCount'], 0)
        self.assertEqual(report['approvedClinicalReviewCount'], 446)
        self.assertEqual(report['typedResponseGuardWithheldCount'], 0)
        for case in report['cases']:
            for domain in case['coreHistory'].values():
                self.assertNotEqual(domain['reviewRequirement'], 'requires-clinical-review')

    def test_coverage_respects_mixed_or_unknown_review_states_without_promoting_them(self):
        from patient_memory_report import core_history
        case = copy.deepcopy(LOCAL_AI_CASES['im-003'])
        source = next(row for row in case['patient']['history'] if row.get('coreHistoryDomain') == 'current-medication')
        for status in ('requires-clinical-review', 'pending-clinical-review', 'unknown-status'):
            source['reviewStatus'] = status
            self.assertEqual(core_history(case, derive_memory(case))['current-medication']['reviewRequirement'], 'requires-clinical-review')
            with patch.dict('patient_memory_report.LOCAL_AI_CASES', {case['caseId']: case}, clear=True):
                self.assertEqual(coverage_report()['pendingClinicalReviewCount'], 1)
        source['reviewStatus'] = 'clinician-approved'
        self.assertEqual(core_history(case, derive_memory(case))['current-medication']['reviewRequirement'], 'clinician-approved')

    def test_review_export_preserves_arabic_attribution_and_unknown_date(self):
        import csv
        import io
        from history_draft_report import artifacts
        exports = artifacts()
        rows = list(csv.DictReader(io.StringIO(exports['history-draft-clinician-review.csv'])))
        self.assertEqual(len(rows), 446)
        for row in rows:
            self.assertEqual(row['reviewerName'], 'الدكتور محمد الأحمد')
            self.assertEqual(row['reviewEvidence'], 'project-owner-attestation')
            self.assertEqual(row['clinicianDecision'], 'approved')
            self.assertEqual(row['reviewerId'], '')
            self.assertEqual(row['reviewedAt'], '')
        self.assertIn('446 approved, 0 pending', exports['history-draft-coverage.md'])

    def test_every_authored_answer_is_reachable_and_exactly_composed(self):
        for case in LOCAL_AI_CASES.values():
            memory = derive_memory(case)
            for row in case['patient']['history']:
                result = retrieve(memory, row['question'])
                self.assertTrue(result.immediate, (case['caseId'], row['id'], result.reason))
                self.assertEqual([f.source_question_id for f in result.candidates], [row['id']], (case['caseId'], row['id']))
                spoken = compose_fact(result.candidates[0], row['question'], is_parent=case['patient']['age'] < 14)
                self.assertEqual(sanitize_patient_response(spoken, case, authored_response=spoken), spoken)
                if not row.get('predefined', True):
                    self.assertIsNone(exact_patient_answer(case, row['id']))

    def test_draft_ids_never_award_history_credit_even_when_forged_in_evidence(self):
        for case in LOCAL_AI_CASES.values():
            original = copy.deepcopy(case)
            original['patient']['history'] = [h for h in case['patient']['history'] if h.get('scoreable', True)]
            evidence = {'asked_question_ids': [h['id'] for h in case['patient']['history']]}
            for index, rule in enumerate(r for r in case['evaluation']['rubric'] if r['sourceDomain'] == 'history'):
                self.assertEqual(_deterministic_assessment(rule, evidence, [], case['evaluation']['correctDiagnosisId'], case, index),
                                 _deterministic_assessment(rule, evidence, [], case['evaluation']['correctDiagnosisId'], original, index))

    def test_paraphrases_work_for_thomas_and_do_not_cross_family_scope(self):
        memory = derive_memory(LOCAL_AI_CASES['card-003'])
        for q, fact in [('Do you get short of breath lying flat?', 'orthopnea'), ('Do you wake up gasping at night?', 'pnd'),
                        ('Have you gained weight?', 'weight'), ('Have you ever had a heart attack?', 'hx'),
                        ('Are your symptoms getting worse?', 'onset')]:
            result = retrieve(memory, q)
            self.assertTrue(result.immediate)
            self.assertEqual(result.candidates[0].source_question_id, fact)
        other = retrieve(memory, 'Has your mother had a heart attack?')
        self.assertFalse(any(f.source_question_id == 'hx' for f in other.candidates))

    def test_authorized_prior_history_does_not_authorize_model_invention(self):
        case = LOCAL_AI_CASES['ctv-002']
        memory = derive_memory(case)
        fact = next(f for f in memory.facts if f.source_question_id == 'family')
        spoken = compose_fact(fact, 'Family cancer history?')
        self.assertEqual(sanitize_patient_response(spoken, case), SAFE_UNKNOWN_RESPONSE)
        self.assertEqual(sanitize_patient_response(spoken, case, authored_response=spoken), spoken)
        fabricated = json.dumps({'fact_ids': [fact.fact_id], 'text': 'I have lung cancer.'})
        self.assertEqual(validate_grounded(fabricated, memory, (fact,), 'Family cancer history?', is_parent=False)[2], 'unsupported-wording')

    def test_typed_draft_is_audited_and_not_scored_and_cannot_be_clicked(self):
        client = TestClient(server.app, headers={'Origin': 'http://localhost:5173'})
        case = LOCAL_AI_CASES['im-003']
        with patch('medsim_backend.services.attempt_service.AttemptService.schedule_case_audio'):
            created = client.post('/api/attempts', json={'caseId':'im-003','caseVersion':case['caseVersion'],'variantSeed':'draft-test'})
        aid = created.json()['attemptId']
        try:
            with patch('medsim_backend.services.patient_dialogue_service.get_local_llm_provider') as provider:
                response = client.post('/agent/patient/stream', json={'attemptId':aid,'source':'typed','question':'What medications are you taking?'})
            self.assertEqual(response.status_code,200)
            provider.assert_not_called()
            attempt = server._INVESTIGATION_ATTEMPTS[aid]
            self.assertEqual(attempt['askedQuestionIds'], [])
            record = list(attempt['patientResponses'].values())[-1]
            self.assertIn('No regular medicines', record['text'])
            self.assertEqual(record['parts'][0]['reviewRequirements']['history:draft-current-medication'], 'clinician-approved')
            rejected = client.post('/agent/patient/stream', json={'attemptId':aid,'source':'predefined','question':'Current medication?','questionId':'draft-current-medication'})
            self.assertEqual(rejected.status_code,422)
        finally:
            server._INVESTIGATION_ATTEMPTS.pop(aid,None)

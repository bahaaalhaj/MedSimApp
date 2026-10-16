"""All-case conversation readiness is offline coverage, never medical approval."""
import json
import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from conversation_audit import run_audit
from local_ai import LOCAL_AI_CASES
from patient_memory import FactState, compose_fact, derive_memory, retrieve, resolve_turn
from patient_interpretation import validate_interpretation


class ConversationReadinessTests(unittest.TestCase):
    def test_all_72_cases_complete_the_real_route_offline_conversation_matrix(self):
        report = run_audit()
        failures = [(row['caseId'],row['failures']) for row in report['cases'] if row['failures']]
        self.assertTrue(report['passed'],failures)
        self.assertEqual(report['caseCount'],72)
        self.assertEqual(report['hostedRequests'],0)
        self.assertEqual(sum(r['authoredHistoryTurns'] for r in report['cases']),881)
        self.assertEqual(sum(r['predefinedTurns'] for r in report['cases']),435)
        self.assertEqual(sum(r['retryChecks'] for r in report['cases']),216)
        self.assertEqual(sum(r['bloodPressureTurns'] for r in report['cases']),72)

    def test_opening_grammar_does_not_swallow_qualified_or_protected_questions(self):
        memory = derive_memory(LOCAL_AI_CASES['id-004'])
        for question in ('How do you feel when you exercise?', 'How do you feel about surgery?',
                         'How are you and what is the diagnosis?', 'How are you after taking medicine?',
                         'How is your mother feeling?', 'How do you feel about your blood pressure?'):
            self.assertNotEqual(retrieve(memory,question).reason,'chief-complaint',question)

    def test_opening_uses_the_active_profile_and_not_a_cached_base_case(self):
        for case in LOCAL_AI_CASES.values():
            profile = {**case['patient'],'chiefComplaint':'An explicitly supplied synthetic concern.'}
            memory = derive_memory(case,profile)
            turn = resolve_turn(memory,'How do you feel?')
            self.assertIsNotNone(turn,case['caseId'])
            self.assertEqual(turn.text,profile['chiefComplaint'])
            self.assertEqual([f.fact_id for f in turn.facts],['profile:chiefComplaint'])

    def test_semantic_qualifiers_keep_their_authored_topic_and_parent_perspective(self):
        case = LOCAL_AI_CASES['id-004']; memory = derive_memory(case)
        selected = json.dumps({'status':'answer','fact_ids':['history:headache','history:fever'],'partial':False})
        for parent,possessive in ((False,'My'),(True,"My child's")):
            result = validate_interpretation(selected,memory,case,is_parent=parent)
            self.assertIsNotNone(result.turn)
            self.assertEqual(result.turn.text,f'{possessive} headache is mild. {possessive} fever is low-grade.')
            self.assertEqual([f.authored_value for f in result.turn.facts],['Mild.','Low-grade.'])

    def test_missing_blood_pressure_is_not_fabricated_or_borrowed_from_family_history(self):
        memory = derive_memory(LOCAL_AI_CASES['id-004'])
        turn = resolve_turn(memory,'What is your blood pressure?')
        self.assertIsNotNone(turn)
        self.assertFalse(turn.facts)
        self.assertEqual(turn.parts[0].intent,'patient-measurement')
        self.assertNotIn('120',turn.text)
        recorded = resolve_turn(derive_memory(LOCAL_AI_CASES['im-003']),'What is your blood pressure?')
        # Existing authored BP history is still retrieved by the existing path.
        result = retrieve(derive_memory(LOCAL_AI_CASES['im-003']),'What is your blood pressure?')
        self.assertEqual(result.candidates[0].source_question_id,'readings')
        self.assertTrue(recorded is None or recorded.facts)

    def test_exact_authored_onset_takes_priority_over_previous_context(self):
        for cid in ('im-005','neuro-003'):
            memory = derive_memory(LOCAL_AI_CASES[cid])
            onset = next(f for f in memory.facts if f.source_question_id == 'onset')
            previous = next(f for f in memory.facts if f.source_question_id and f != onset)
            context = {'caseId':cid,'caseVersion':memory.case_version,'factIds':[previous.fact_id]}
            turn = resolve_turn(memory,onset.question,context)
            self.assertEqual(turn.facts,(onset,))
            self.assertEqual(turn.text,compose_fact(onset,onset.question))

    def test_qualifier_presentation_never_turns_a_denial_or_unknown_into_a_symptom(self):
        from patient_interpretation import compose_semantic_fact
        fact = next(f for f in derive_memory(LOCAL_AI_CASES['id-004']).facts if f.source_question_id == 'fever')
        for status,value in ((FactState.NEGATIVE,'No.'),(FactState.UNKNOWN,'Unknown')):
            changed = replace(fact,status=status,patient_safe_value=value,authored_value=value)
            self.assertEqual(compose_semantic_fact(changed,is_parent=False),compose_fact(changed,changed.question))


if __name__ == '__main__':
    unittest.main()

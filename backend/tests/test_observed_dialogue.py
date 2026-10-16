"""Regressions from the user's actual Thomas/Sarah browser transcripts."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import server
from local_ai import LOCAL_AI_CASES
from patient_memory import derive_memory, resolve_turn, retrieve

OBSERVED = {
 'card-003': [
 ('What brings you in today?', 'profile:chiefComplaint', 'mailbox'),
 ('How long have you had these symptoms?', 'history:onset', '3 months'),
 ('Do you get short of breath lying flat?', 'history:orthopnea', 'Three pillows'),
 ('Do you wake up gasping for breath at night?', 'history:pnd', 'Twice a week'),
 ('Have you noticed any weight gain recently?', 'history:weight', '4 kg'),
 ('Have you ever had a heart attack?', 'history:hx', '4 years'),
 ('Have you travelled recently?', 'history:travel', 'No travel'),
 ],
 'id-004': [
 ('What brings you in today?', 'profile:chiefComplaint', 'bullseye'),
 ('Have you been camping or travelling recently?', 'history:travel', 'Forest camping'),
 ('Did you notice a tick bite?', 'history:tick', '10 days'),
 ('When did you remove the tick?', 'history:tick', '10 days'),
 ('Can you describe the rash on your leg?', 'history:rash', 'Red ring'),
 ('Which joints are painful?', 'history:joints', 'Knees'),
 ('Have you had a fever?', 'history:fever', 'Low-grade'),
 ('Have you had a headache?', 'history:headache', 'Mild'),
 ('Have you noticed any facial weakness?', 'history:draft-relevant-negative-symptoms', 'No facial weakness'),
 ('Have you had palpitations or fainting?', 'history:draft-relevant-negative-symptoms', 'palpitations'),
 ('What medications are you taking?', 'history:draft-current-medication', 'paracetamol'),
 ('Do you have any drug allergies?', 'history:draft-drug-allergies', 'No known drug allergies'),
 ('Does the rash look like a red ring with a clearer centre?', 'history:rash', 'Red ring'),
 ('Are your knees aching?', 'history:joints', 'Knees'),
 ],
}

class ObservedDialogueTests(unittest.TestCase):
 def test_entire_observed_sequence_passes_real_sse_endpoint_without_provider(self):
  client=TestClient(server.app,headers={'Origin':'http://localhost:5173'})
  for cid,turns in OBSERVED.items():
   with patch('medsim_backend.services.attempt_service.AttemptService.schedule_case_audio'):
    created=client.post('/api/attempts',json={'caseId':cid,'caseVersion':LOCAL_AI_CASES[cid]['caseVersion'],'variantSeed':'observed-dialogue'})
   aid=created.json()['attemptId']
   try:
    for i,(question,fact,excerpt) in enumerate(turns):
     with self.subTest(case=cid,question=question), patch('medsim_backend.services.patient_dialogue_service.get_local_llm_provider') as provider:
      response=client.post('/agent/patient/stream',json={'attemptId':aid,'source':'typed','question':question,'requestId':f'observed-dialogue-turn-{i}'})
      self.assertEqual(response.status_code,200,response.text)
      provider.assert_not_called()
      frames=[json.loads(frame[6:]) for frame in response.text.strip().split('\n\n')]
      text=''.join(frame.get('text','') for frame in frames)
      self.assertIn(excerpt,text)
      record=server._INVESTIGATION_ATTEMPTS[aid]['patientResponses'][f'observed-dialogue-turn-{i}']
      self.assertIn(fact,record['matchedFactIds'])
      self.assertEqual(frames[-1]['provenance'],'deterministic-authored')
    with patch('medsim_backend.services.patient_dialogue_service.get_local_llm_provider') as provider:
     response=client.post('/agent/patient/stream',json={'attemptId':aid,'source':'typed','question':'What is the correct diagnosis for this case?'})
     provider.assert_not_called()
     self.assertIn('not sure what the diagnosis',response.text)
   finally:
    server._INVESTIGATION_ATTEMPTS.pop(aid,None)

 def test_timing_and_anatomy_are_not_invented_from_related_sources(self):
  sarah=derive_memory(LOCAL_AI_CASES['id-004'])
  for question in ('How long have you had the rash?', 'Which ankle joint is painful?', 'How long have you had fever and rash?'):
   result=retrieve(sarah,question)
   self.assertFalse(result.immediate and result.candidates,question)
  self.assertFalse(resolve_turn(sarah,'Does your father have joint pain?').facts)
  skin=derive_memory(LOCAL_AI_CASES['derm-001'])
  result=retrieve(skin,'Are your knees aching?')
  self.assertFalse(result.immediate and result.candidates)

 def test_same_topics_apply_to_other_patients_and_missing_fever_is_not_a_denial(self):
  for cid,q,id in [('ent-003','Have you noticed a rash?','history:rash'),('gs-004','Have you had a fever?','history:fever')]:
   result=retrieve(derive_memory(LOCAL_AI_CASES[cid]),q)
   self.assertTrue(result.immediate)
   self.assertEqual(result.candidates[0].fact_id,id)
  result=retrieve(derive_memory(LOCAL_AI_CASES['allergy-001']),'Have you had a fever?')
  self.assertFalse(result.candidates)

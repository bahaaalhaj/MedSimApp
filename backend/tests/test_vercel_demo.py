import asyncio
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from local_ai import LOCAL_AI_CASES
from local_llm import ChatCompletion, LLMProviderError, SerializingLocalLLMProvider
from medsim_backend.demo_runtime import create_demo_runtime
from medsim_backend.demo_provider import DemoProvider, demo_owner
from medsim_backend.redis_store import RELEASE, UpstashCommands
from medsim_backend.schemas import EvaluationRequest
from redis_test_support import RedisCommands

def factory_for_test():
    return SerializingLocalLLMProvider(ScriptedProvider())


ORIGIN = 'https://demo.example.test'


class ScriptedProvider:
    def __init__(self):
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()
        self.block = False
        self.answer = None

    async def health(self):
        return SimpleNamespace(state='unavailable', safety_status='configured-only', last_error_category='offline-test',
                               provider='scripted-offline', model='offline')

    async def complete_chat(self, request):
        self.calls += 1
        self.entered.set()
        if self.block:
            while not self.release.is_set():
                await asyncio.sleep(.01)
        if self.answer is not None:
            return ChatCompletion(self.answer, 'offline-scripted-model', request.request_id, 0, ('offline-scripted-model',))
        raise LLMProviderError('model-unavailable', 'Offline scripted failure', True)


class DemoRedisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ.get('TEST_REDIS_URL')
        if not url:
            if os.environ.get('CI'):
                raise RuntimeError('CI must supply a real disposable TEST_REDIS_URL')
            raise unittest.SkipTest('Set TEST_REDIS_URL to a disposable loopback Redis (see demo guide)')
        cls.commands = RedisCommands(url)
        assert cls.commands('PING') == 'PONG'

    def setUp(self):
        self.namespace = 'test_' + secrets.token_hex(8)
        self.env = self.enterContext(patch.dict(os.environ, {
            'MEDSIM_DEPLOYMENT_MODE': 'vercel-guest-demo', 'MEDSIM_DEMO_ORIGINS': ORIGIN,
            'MEDSIM_DEMO_NAMESPACE': self.namespace,
            'MEDSIM_DEMO_GUEST_SIGNING_SECRET': secrets.token_hex(32),
        }))
        self.provider = ScriptedProvider()
        def factory():
            return SerializingLocalLLMProvider(self.provider)
        self.a = create_demo_runtime(commands=self.commands, provider_factory=factory)
        self.b = create_demo_runtime(commands=RedisCommands(os.environ['TEST_REDIS_URL']), provider_factory=factory)
        self.client_a = self.enterContext(TestClient(self.a.app, base_url=ORIGIN, headers={'Origin': ORIGIN}))
        self.client_b = self.enterContext(TestClient(self.b.app, base_url=ORIGIN, headers={'Origin': ORIGIN}))
        self.addCleanup(self.cleanup_keys)
        response = self.client_a.get('/api/capabilities')
        self.assertEqual(response.status_code, 200)
        self.cookie = response.headers['set-cookie']
        self.client_b.cookies.update(self.client_a.cookies)
        self.case = next(iter(LOCAL_AI_CASES.values()))
        self.payload = {'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'], 'variantSeed': 'demo-test',
                        'clientAttemptId': secrets.token_hex(16), 'evidenceVersion': 2, 'dialogueDeliveryVersion': 1}
        response = self.client_a.post('/api/attempts', json=self.payload)
        self.assertEqual(response.status_code, 201, response.text)
        self.attempt_id = response.json()['attemptId']

    def cleanup_keys(self):
        # Only this test's random namespace; never FLUSHDB/FLUSHALL.
        keys = self.commands('KEYS', 'medsim:demo:{' + self.namespace + '}:*')
        if keys:
            self.commands('DEL', *keys)

    def request(self, owner=None):
        guest = owner or self.client_a.get('/api/capabilities').json()['guestId'].removeprefix('demo_')
        return Request({'type': 'http', 'headers': [], 'state': {'guest_id': guest}})

    def recovery(self, client=None):
        response = (client or self.client_b).get('/api/attempts/' + self.attempt_id + '/recovery')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def question(self, predefined=True):
        item = self.case['patient']['history'][0]
        return {'attemptId': self.attempt_id, 'question': item['question'] if predefined else 'Has this changed the way you do your everyday activities?',
                'source': 'predefined' if predefined else 'typed', 'questionId': item['id'] if predefined else None,
                'requestId': secrets.token_hex(16)}

    def test_cookie_cross_instance_owner_and_origin(self):
        self.assertIn('Secure', self.cookie)
        self.assertIn('HttpOnly', self.cookie)
        self.assertIn('SameSite=lax', self.cookie)
        self.assertEqual(self.recovery()['attemptId'], self.attempt_id)
        same = self.client_b.post('/api/attempts', json=self.payload)
        self.assertEqual(same.json()['attemptId'], self.attempt_id)
        # A separate HTTP client, not a nested lifecycle on the same app.
        with TestClient(create_demo_runtime(commands=self.commands, provider_factory=factory_for_test).app, base_url=ORIGIN, headers={'Origin': ORIGIN}) as stranger:
            self.assertEqual(stranger.get('/api/attempts/' + self.attempt_id + '/recovery').status_code, 404)
            prefix = '/api/attempts/' + self.attempt_id
            for path, payload in [
                (prefix + '/dialogue/acknowledgements', {'requestId': 'unknown-request-id'}),
                (prefix + '/completion', {'summaryCompleted': True}),
                (prefix + '/diagnosis', {'diagnosisId': self.case['evaluation']['correctDiagnosisId']}),
                (prefix + '/prescriptions', {'medicationId': 'test', 'dose': '', 'duration': '', 'prescribedAt': time.time()}),
                (prefix + '/investigations/orders', {'investigationId': 'test'}),
                ('/agent/patient/stream', self.question()),
                ('/api/local-ai/evaluate', {'attemptId': self.attempt_id, 'caseId': self.case['caseId'],
                    'caseVersion': self.case['caseVersion'], 'variantSeed': 'demo-test'}),
            ]:
                self.assertEqual(stranger.post(path, json=payload).status_code, 404, path)
            self.assertEqual(stranger.get(prefix + '/investigations').status_code, 404)
            self.assertEqual(stranger.get(prefix + '/investigations/unknown-order-id').status_code, 404)
        for headers in ({'Origin': 'https://evil.test'}, {'Host': 'evil.test', 'X-Forwarded-Host': 'demo.example.test'},
                        {'Origin': 'https://evil.test', 'X-Forwarded-Proto': 'https'}):
            self.assertEqual(self.client_b.post('/api/attempts', json=self.payload, headers=headers).status_code, 403)
        self.assertEqual(self.client_a.post('/api/auth/login', json={}).status_code, 404)
        self.assertEqual(self.client_a.post('/tts/synthesize', json={}).status_code, 404)

    def test_delivery_replay_receipts_and_authoritative_evidence(self):
        question = self.question()
        first = self.client_a.post('/agent/patient/stream', json=question)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.text.count('"done":true'), 1)
        before = self.recovery()
        self.assertEqual(before['pendingDialogueRequestIds'], [question['requestId']])
        replay = self.client_b.post('/agent/patient/stream', json=question)
        self.assertEqual(replay.text, first.text)
        self.assertEqual(self.recovery()['transcript'], before['transcript'])
        blocked = self.client_b.post('/agent/patient/stream', json=self.question())
        self.assertEqual(blocked.status_code, 409)
        ack = '/api/attempts/' + self.attempt_id + '/dialogue/acknowledgements'
        for client in (self.client_a, self.client_b):
            self.assertEqual(client.post(ack, json={'requestId': question['requestId']}).status_code, 200)
        self.assertEqual(self.recovery()['pendingDialogueRequestIds'], [])
        self.assertEqual(self.provider.calls, 0)
        public = json.dumps(before)
        self.assertNotIn('correctDiagnosisId', public)
        self.assertNotIn('localAiCase', public)

    def test_scripted_semantic_success_replays_across_instances_without_scoring_authority(self):
        from patient_memory import derive_memory
        memory = derive_memory(self.case, self.case['patient'])
        fact = next(fact for fact in memory.facts if fact.source_question_id)
        self.provider.answer = json.dumps({'status': 'answer', 'fact_ids': [fact.fact_id], 'partial': False})
        question = self.question(False)
        response = self.client_a.post('/agent/patient/stream', json=question)
        self.assertEqual(response.text.count('"done":true'), 1, response.text)
        self.assertIn('"provenance":"openrouter"', response.text)
        self.assertEqual(self.provider.calls, 1)
        before = self.recovery()
        self.assertEqual(len(before['transcript']), 3)
        self.assertEqual(before['askedQuestionIds'], [])
        self.assertEqual(self.client_b.post('/agent/patient/stream', json=question).text, response.text)
        self.assertEqual(self.provider.calls, 1)
        self.assertEqual(self.recovery()['transcript'], before['transcript'])

    def test_expiry_stale_locks_fencing_and_no_lost_update(self):
        req = self.request()
        key = self.a.attempt_store.key(self.attempt_id)
        # First prove exclusion with the production-length lock; an 80 ms lock
        # could expire during HTTP scheduling on a busy Windows test host.
        self.commands('SET', key + ':lock', 'previous-worker', 'PX', 5000)
        self.assertEqual(self.client_b.get('/api/attempts/' + self.attempt_id + '/recovery').status_code, 409)
        self.assertEqual(self.commands('EVAL', RELEASE, 1, key + ':lock', 'wrong-owner'), 0)
        self.commands('PEXPIRE', key + ':lock', 80)
        time.sleep(.1)
        self.assertIsNone(self.commands('GET', key + ':lock'))
        ttl = self.commands('PTTL', key)
        with self.a.attempt_store.transaction(req, self.attempt_id) as attempt:
            attempt['completionChecks'] = {'summaryCompleted': True}
            # A second independent store cannot enter or overwrite this update.
            with self.assertRaises(HTTPException) as error:
                with self.b.attempt_store.transaction(req, self.attempt_id):
                    self.fail('concurrent transaction entered')
            self.assertEqual(error.exception.status_code, 409)
        self.assertTrue(self.recovery()['completionChecks']['summaryCompleted'])
        self.assertLessEqual(self.commands('PTTL', key), ttl)
        with self.assertRaises(HTTPException):
            with self.a.attempt_store.transaction(req, self.attempt_id) as attempt:
                attempt['completionChecks'] = {'lost': True}
                self.commands('SET', key + ':lock', 'new-worker', 'PX', 5000)
        self.commands('DEL', key + ':lock')
        self.assertNotIn('lost', self.recovery()['completionChecks'])
        self.commands('PEXPIRE', key, 1)
        time.sleep(.02)
        self.assertEqual(self.client_b.get('/api/attempts/' + self.attempt_id + '/recovery').status_code, 404)

    def test_duplicate_dispatch_failure_and_interruption_are_not_speech(self):
        self.provider.block = True
        question = self.question(False)
        with ThreadPoolExecutor() as workers:
            future = workers.submit(self.client_a.post, '/agent/patient/stream', json=question)
            self.assertTrue(self.provider.entered.wait(3), 'Question did not exercise the provider')
            duplicate = self.client_b.post('/agent/patient/stream', json=question)
            self.assertEqual(duplicate.status_code, 409)
            self.provider.release.set()
            response = future.result(5)
        self.assertEqual(self.provider.calls, 1)
        self.assertIn('"error"', response.text)
        self.assertNotIn('"done":true', response.text)
        self.assertEqual(len(self.recovery()['transcript']), 1)
        again = self.client_b.post('/agent/patient/stream', json=question)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.provider.calls, 1)
        # Simulate invocation termination: no finally, no background process.
        req = self.request()
        with self.a.attempt_store.transaction(req, self.attempt_id) as attempt:
            attempt['patientRequestActive'] = True
            attempt['patientRequestLease'] = {'token': 'dead', 'expiresAt': time.time() - 1}
        self.recovery()  # Clears the stale busy flag without inventing evidence.
        with self.b.attempt_store.transaction(req, self.attempt_id) as attempt:
            self.assertFalse(attempt['patientRequestActive'])
            with self.assertRaises(HTTPException):
                self.a.attempt_store.check_claim(attempt, 'patientRequest', 'dead')

    def test_evaluation_stale_busy_caching_and_85_point_scope(self):
        req = self.request()
        with self.a.attempt_store.transaction(req, self.attempt_id) as attempt:
            attempt['evaluationActive'] = True
            attempt['evaluationLease'] = {'token': 'worker', 'expiresAt': time.time() + 30}
        payload = {'attemptId': self.attempt_id, 'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'], 'variantSeed': 'demo-test'}
        self.assertEqual(self.client_b.post('/api/local-ai/evaluate', json=payload).status_code, 409)
        with self.a.attempt_store.transaction(req, self.attempt_id) as attempt:
            attempt['evaluationLease']['expiresAt'] = time.time() - 1
        response = self.client_b.post('/api/local-ai/evaluate', json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(sum(domain['max'] for domain in result['domain_scores'].values()), 85)
        self.assertEqual(self.client_a.post('/api/local-ai/evaluate', json=payload).json(), result)
        self.assertEqual(self.recovery()['evaluationResult'], result)
        self.assertFalse(self.recovery()['evaluationActive'])

    def test_investigations_and_actions_alternate_instances_and_survive_review(self):
        prefix = '/api/attempts/' + self.attempt_id
        definitions = self.a.attempts.investigation_cases[self.case['caseId']]['investigations']
        investigation = next(item for item in definitions if item['availability'] in {'available-if-ordered', 'result-available'})
        order = self.client_a.post(prefix + '/investigations/orders', json={'investigationId': investigation['testId']})
        self.assertEqual(order.status_code, 201, order.text)
        order = order.json()
        replay = self.client_b.post(prefix + '/investigations/orders', json={'investigationId': investigation['testId']})
        self.assertEqual(replay.json()['orderId'], order['orderId'])
        with self.a.attempt_store.transaction(self.request(), self.attempt_id) as attempt:
            attempt['orders'][order['orderId']]['availableAt'] = time.time() - 1
        result_path = prefix + '/investigations/' + order['orderId']
        result = self.client_b.get(result_path)
        self.assertIsNotNone(result.json()['resultSnapshot'])
        diagnosis = self.case['evaluation']['diagnosisOptionIds'][0]
        self.assertEqual(self.client_a.post(prefix + '/diagnosis', json={'diagnosisId': diagnosis}).status_code, 201)
        prescription = {'medicationId': 'test-record-only', 'dose': 'test', 'duration': 'test', 'prescribedAt': time.time()}
        self.assertEqual(self.client_b.post(prefix + '/prescriptions', json=prescription).status_code, 201)
        self.assertEqual(self.client_a.post(prefix + '/completion', json={'summaryCompleted': True}).status_code, 201)
        recovered = self.recovery()
        self.assertEqual(recovered['submittedDiagnosisId'], diagnosis)
        self.assertEqual(len(recovered['prescriptions']), 1)
        self.assertIsNotNone(recovered['orders'][0]['resultSnapshot'])
        payload = {'attemptId': self.attempt_id, 'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'], 'variantSeed': 'demo-test'}
        self.assertEqual(self.client_b.post('/api/local-ai/evaluate', json=payload).status_code, 200)
        # Reviews can still read already released results, without adding new evidence.
        self.assertEqual(self.client_a.get(result_path).json(), result.json())
        self.assertEqual(self.client_a.get(prefix + '/investigations').status_code, 200)

    def test_cancelled_evaluation_is_invocation_owned_and_recoverable(self):
        req = self.request()
        payload = EvaluationRequest(attemptId=self.attempt_id, caseId=self.case['caseId'],
                                    caseVersion=self.case['caseVersion'], variantSeed='demo-test')

        async def run():
            entered = asyncio.Event()

            async def health():
                entered.set()
                await asyncio.Future()

            provider = SimpleNamespace(health=health)
            from local_llm import bind_application_provider
            with bind_application_provider(provider):
                task = asyncio.create_task(self.a.evaluation.evaluate(payload, req))
                await entered.wait()
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertFalse(self.a.evaluation._tasks)
        asyncio.run(run())
        self.assertFalse(self.recovery()['evaluationActive'])
        self.assertIsNone(self.recovery()['evaluationResult'])

    def test_shared_admission_is_global_not_per_instance(self):
        first = DemoProvider(SimpleNamespace(), self.a.attempt_store)
        second = DemoProvider(SimpleNamespace(), self.b.attempt_store)

        async def run():
            token = demo_owner.set('same-signed-guest')
            try:
                async with first.admission():
                    with self.assertRaises(LLMProviderError):
                        async with second.admission():
                            self.fail('cross-instance concurrency limit bypassed')
                for _ in range(2):
                    async with second.admission():
                        pass
                with self.assertRaises(LLMProviderError):
                    async with first.admission():
                        self.fail('shared per-owner rate limit bypassed')
            finally:
                demo_owner.reset(token)
        asyncio.run(run())

    def test_owner_limit_and_redis_failure(self):
        for i in range(31):
            self.assertEqual(self.client_b.post('/api/attempts', json={**self.payload, 'clientAttemptId': 'create_' + str(i).zfill(12)}).status_code, 201)
        response = self.client_a.post('/api/attempts', json={**self.payload, 'clientAttemptId': 'limit_' + 'x' * 12})
        self.assertEqual(response.status_code, 429)
        def unavailable(*_args):
            raise OSError('private diagnostic never returned')
        self.b.attempt_store.commands = unavailable
        response = self.client_b.get('/api/attempts/' + self.attempt_id + '/recovery')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.text)


class DemoStartupTests(unittest.TestCase):
    def test_missing_configuration_and_upstash_transport_fail_closed(self):
        with patch.dict(os.environ, {'MEDSIM_DEPLOYMENT_MODE': 'vercel-guest-demo', 'MEDSIM_DEMO_GUEST_SIGNING_SECRET': ''}):
            with self.assertRaisesRegex(ValueError, 'SIGNING_SECRET'):
                create_demo_runtime()
        with self.assertRaises(ValueError):
            UpstashCommands('', '')
        with self.assertRaises(ValueError):
            UpstashCommands('http://localhost', 'not-a-real-credential')

    def test_fresh_demo_import_does_not_import_auth_sqlite_or_tts(self):
        script = '''
import importlib.abc, os, secrets, socket, sys
class Reject(importlib.abc.MetaPathFinder):
 def find_spec(self, fullname, path=None, target=None):
  if fullname.split('.')[0] in {'auth_system','sqlite3','tts','torch','kokoro'}:
   raise AssertionError('forbidden demo import: ' + fullname)
sys.meta_path.insert(0, Reject())
socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(AssertionError('startup network'))
os.environ.update(MEDSIM_DEPLOYMENT_MODE='vercel-guest-demo', MEDSIM_DEMO_ORIGINS='https://demo.example.test',
 MEDSIM_DEMO_NAMESPACE='offline_import', MEDSIM_DEMO_GUEST_SIGNING_SECRET=secrets.token_hex(32),
 UPSTASH_REDIS_REST_URL='https://offline-example.upstash.io', UPSTASH_REDIS_REST_TOKEN='offline-test-value',
 MEDSIM_LLM_PROVIDER='openrouter', OPENROUTER_API_KEY='offline-test-value',
 OPENROUTER_MODEL='nvidia/nemotron-3.5-super-vl:free', OPENROUTER_FALLBACK_MODELS='',
 OPENROUTER_PRO_FALLBACK_ENABLED='false', MEDSIM_LOCAL_LLM_ENABLED='false')
from api.index import app
import asyncio
async def check():
 async with app.router.lifespan_context(app):
  assert app.state.llm_provider.delegate.settings.patient_timeout_seconds == 7.8
  assert app.state.llm_provider.delegate.settings.hosted_semantic_timeout_seconds == 8.0
asyncio.run(check())
print('demo startup: no auth/sqlite/TTS/network')
'''
        env = {**os.environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1])}
        completed = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, env=env, timeout=15)
        self.assertEqual(completed.returncode, 0, completed.stderr)

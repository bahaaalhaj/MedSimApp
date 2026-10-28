"""Real owner-bound routes, scripted evaluation, and disconnected caller recovery."""
from __future__ import annotations

import asyncio
import time
import unittest
import uuid
from contextlib import closing
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from fastapi import Request

from auth_system import iso, utcnow
from medsim_backend.schemas import EvaluationRequest
import test_pilot as fixtures
from tts.providers import TTSManager, TTSRequest, TTSResult, load_tts_settings


class RecoveryTests(unittest.TestCase):
    setUp = fixtures.PilotTests.setUp
    client = fixtures.PilotTests.client
    register = fixtures.PilotTests.register

    def create(self, client=None):
        return (client or self.one).post('/api/attempts', json={
            'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'],
            'evidenceVersion': 2, 'clientAttemptId': 'recovery-client-00001', 'variantSeed': 'recovery-seed',
        }).json()['attemptId']

    def test_recovery_releases_only_visible_evidence_and_owners_are_isolated(self):
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        history = attempt['localAiCase']['patient']['history'][0]
        response = self.one.post('/agent/patient/stream', json={'attemptId': aid, 'source': 'predefined',
            'questionId': history['id'], 'question': history['question'], 'requestId': 'recovery-question-0001'})
        self.assertIn('"done":true', response.text)
        view = self.one.get(f'/api/attempts/{aid}/recovery').json()
        self.assertEqual(view['visibleAnswers'][history['id']]['answer'], history['answer'])
        self.assertEqual(len(view['transcript']), 3)
        for row in view['transcript']:
            self.assertEqual(set(row), {'role', 'content', 'timestampIso', 'questionSource'})
        self.assertNotIn('localAiCase', view)
        self.assertNotIn('owner', view)
        self.assertNotIn('dialogueProvenance', str(view))
        self.assertNotIn('correctDiagnosisId', view)
        self.assertIsNone(view['evaluationResult'])
        self.assertEqual(self.two.get(f'/api/attempts/{aid}/recovery').status_code, 404)
        self.register(self.two, 'other-recovery@example.com')
        self.assertEqual(self.two.get(f'/api/attempts/{aid}/recovery').status_code, 404)
        self.register(self.one, 'account-recovery@example.com')
        # Logging into an account does not adopt the guest attempt.
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').status_code, 404)
        account_aid = self.create()
        self.assertEqual(self.one.get(f'/api/attempts/{account_aid}/recovery').status_code, 200)
        self.assertEqual(self.two.get(f'/api/attempts/{account_aid}/recovery').status_code, 404)

    def test_missing_expired_restarted_and_version_changed_recovery(self):
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        attempt['expiresAt'] = time.time() - 1
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').status_code, 404)
        attempt['expiresAt'] = time.time() + 100
        attempt['caseVersion'] = 'obsolete-version'
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').status_code, 409)
        self.runtime.attempt_store.attempts.clear()
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').status_code, 404)

    def test_repeated_actions_and_grading_retrieve_one_result_and_one_saved_record(self):
        self.register(self.one, 'save-recovery@example.com')
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        rx = {'medicationId': 'test-medication', 'dose': 'test dose', 'duration': 'test duration', 'prescribedAt': 1000}
        for _ in range(2):
            self.assertEqual(self.one.post(f'/api/attempts/{aid}/prescriptions', json=rx).status_code, 201)
            self.assertEqual(self.one.post(f'/api/attempts/{aid}/examinations', json={'actionId': 'general-observation', 'performedAt': 1000}).status_code, 201)
        provider = AsyncMock()
        provider.health.side_effect = RuntimeError('scripted offline failure')
        payload = {'attemptId': aid, 'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'], 'variantSeed': 'recovery-seed'}
        with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
            first = self.one.post('/api/local-ai/evaluate', json=payload)
            second = self.one.post('/api/local-ai/evaluate', json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), second.json())
        provider.health.assert_awaited_once()
        self.assertEqual((len(attempt['prescriptions']), len(attempt['examinations'])), (1, 1))
        view = self.one.get(f'/api/attempts/{aid}/recovery').json()
        self.assertFalse(view['evaluationActive'])
        self.assertEqual(view['evaluationResult'], first.json())
        self.assertEqual(first.json()['generation']['mode'], 'deterministic-fallback')
        saved = {'caseId': self.case['caseId'], 'caseName': 'Recovery fixture', 'caseAge': 30, 'caseGender': 'F',
            'diagnosisLabel': '', 'verdict': first.json()['global_rating'], 'evaluation': first.json(),
            'patientSnapshot': {'arrivedAt': 1000, 'investigationAttemptId': aid}}
        a = self.one.post('/api/progress/encounters', json=saved)
        b = self.one.post('/api/progress/encounters', json=saved)
        self.assertEqual(a.json()['id'], b.json()['id'])
        self.assertEqual(len(self.one.get('/api/progress/encounters').json()['encounters']), 1)

    def test_disconnect_does_not_cancel_grading_and_concurrent_retry_joins_task(self):
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        owner = attempt['owner']
        request = Request({'type': 'http', 'headers': [], 'state': {'guest_id': owner.removeprefix('guest:')}})
        payload = EvaluationRequest(attemptId=aid, caseId=self.case['caseId'], caseVersion=self.case['caseVersion'], variantSeed='recovery-seed')
        async def run():
            entered, release = asyncio.Event(), asyncio.Event()
            provider = AsyncMock()
            async def health():
                entered.set()
                await release.wait()
                raise RuntimeError('scripted unavailable')
            provider.health.side_effect = health
            with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
                first = asyncio.create_task(self.runtime.evaluation_service.evaluate(payload, request))
                await entered.wait()
                self.assertTrue(attempt['evaluationActive'])
                first.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await first
                retry = asyncio.create_task(self.runtime.evaluation_service.evaluate(payload, request))
                await asyncio.sleep(0)
                release.set()
                result = await retry
                self.assertEqual(result, attempt['evaluationResult'])
                self.assertFalse(attempt['evaluationActive'])
                provider.health.assert_awaited_once()
                self.assertEqual(await self.runtime.evaluation_service.evaluate(payload, request), result)
        asyncio.run(run())

    def test_unexpected_grading_exception_clears_busy_and_allows_retry(self):
        aid = self.create()
        attempt = self.runtime.attempt_store.attempts[aid]
        request = Request({'type': 'http', 'headers': [], 'state': {'guest_id': attempt['owner'].removeprefix('guest:')}})
        payload = EvaluationRequest(attemptId=aid, caseId=self.case['caseId'], caseVersion=self.case['caseVersion'], variantSeed='recovery-seed')
        async def run():
            provider = AsyncMock()
            provider.health.side_effect = RuntimeError('scripted unavailable')
            with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
                with patch('medsim_backend.services.evaluation_service.normalize_evaluation', side_effect=ValueError('fixture')):
                    with self.assertRaises(ValueError):
                        await self.runtime.evaluation_service.evaluate(payload, request)
                self.assertFalse(attempt['evaluationActive'])
                self.assertIsNone(attempt['evaluationResult'])
                result = await self.runtime.evaluation_service.evaluate(payload, request)
                self.assertEqual(result['generation']['mode'], 'deterministic-fallback')
        asyncio.run(run())

    def test_https_session_restore_revoke_expiry_and_logout(self):
        from auth_system import AuthApi
        self.register(self.one, 'session-recovery@example.com')
        self.assertTrue(self.one.get('/api/auth/session').json()['authenticated'])
        token = self.one.cookies[AuthApi.SESSION_COOKIE]
        repository = self.runtime.auth_api.service.repository
        with closing(repository.connect()) as conn, conn:
            conn.execute('UPDATE auth_sessions SET expires_at = ?', (iso(utcnow() - timedelta(seconds=1)),))
        self.assertFalse(self.one.get('/api/auth/session').json()['authenticated'])
        user = self.runtime.auth_api.service.verify_login('session-recovery@example.com', 'pilot-test-password-42')
        token, _ = self.runtime.auth_api.service.issue_session(user['id'], True)
        self.one.cookies.set(AuthApi.SESSION_COOKIE, token)
        self.assertTrue(self.one.get('/api/auth/session').json()['authenticated'])
        self.assertEqual(self.one.post('/api/auth/logout').status_code, 204)
        self.one.cookies.set(AuthApi.SESSION_COOKIE, token)
        self.assertFalse(self.one.get('/api/auth/session').json()['authenticated'])

    def test_same_case_tts_requests_from_different_attempts_do_not_supersede(self):
        async def run():
            manager = TTSManager(load_tts_settings({'PATIENT_TTS_PROVIDER': 'disabled'}))
            provider = AsyncMock()
            provider.synthesize.side_effect = lambda request: TTSResult(b'wav', 'audio/wav', 24000, 'scripted', 'fixture', request.text, request.text)
            manager._provider = provider
            await manager._synthesis_slot.acquire()
            one = asyncio.create_task(manager.synthesize(TTSRequest('First.', 'same-case', request_id='request-one', session_scope='attempt-one')))
            two = asyncio.create_task(manager.synthesize(TTSRequest('Second.', 'same-case', request_id='request-two', session_scope='attempt-two')))
            await asyncio.sleep(0)
            manager._synthesis_slot.release()
            results = await asyncio.gather(one, two)
            self.assertEqual([item.transcript_text for item in results], ['First.', 'Second.'])
        asyncio.run(run())

    def test_pilot_keeps_safe_request_ids_and_tts_phase_headers(self):
        aid = self.create()
        manager = AsyncMock()
        manager._provider = None
        manager.synthesize.return_value = TTSResult(b'wav', 'audio/wav', 24000, 'scripted', 'fixture', 'Hello.', 'Hello.',
            timings=(('tts-init', 12.0), ('tts-synthesis', 5.0)))
        with patch('medsim_backend.routes.diagnostics.get_tts_manager', return_value=manager):
            response = self.one.post('/tts/synthesize', headers={'x-request-id': 'untrusted-header-value'},
                json={'attemptId': aid, 'caseId': self.case['caseId'], 'caseVersion': self.case['caseVersion'], 'text': 'Hello.'})
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(uuid.UUID(response.headers['X-MedSim-Request-Id']), uuid.UUID)
        self.assertIn('tts-init;dur=12.000', response.headers['Server-Timing'])
        self.assertIn('tts-synthesis;dur=5.000', response.headers['Server-Timing'])
        self.assertEqual(manager.synthesize.await_args.args[0].session_scope, aid)

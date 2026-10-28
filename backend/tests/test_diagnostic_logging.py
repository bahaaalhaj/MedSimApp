"""Offline diagnostic coverage: no hosted requests, speech models, or secrets."""
from __future__ import annotations

import asyncio
import io
import json
import logging
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from test_support import TestClient
from local_llm import LLMProviderError
from medsim_backend import diagnostic_logging as diagnostics
from medsim_backend.application import create_application, lifespan
from medsim_backend.config import RuntimeSettings
from medsim_backend.services import patient_dialogue_service as dialogue
from medsim_backend.services import evaluation_service as evaluation
from slowapi import Limiter
from slowapi.util import get_remote_address
from tts import TTSConfigurationError, TTSProviderError
from tts.providers import TTSManager, load_tts_settings


class DiagnosticCapture:
    def capture(self):
        context = self.assertLogs('medsim.diagnostics', level='INFO')
        captured = context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)
        return captured

    @staticmethod
    def events(captured):
        return [json.loads(record.getMessage()) for record in captured.records]


class DiagnosticTests(DiagnosticCapture, unittest.TestCase):
    def test_terminal_configuration_is_idempotent_and_does_not_enable_body_loggers(self):
        logger = logging.getLogger('medsim.diagnostics')
        handlers, level, propagate = logger.handlers[:], logger.level, logger.propagate
        self.addCleanup(setattr, logger, 'handlers', handlers)
        self.addCleanup(setattr, logger, 'level', level)
        self.addCleanup(setattr, logger, 'propagate', propagate)
        logger.handlers = []
        output = io.StringIO()
        root_handlers = logging.getLogger().handlers[:]
        with patch('sys.stderr', output):
            diagnostics.configure_terminal_logging()
            diagnostics.configure_terminal_logging()
            diagnostics.log_event('backend-started', level=logging.INFO)
        self.assertEqual(len(logger.handlers), 1)
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertIn('backend-started', output.getvalue())
        self.assertEqual(logging.getLogger().handlers, root_handlers)

    def test_untrusted_ids_messages_and_exception_text_are_not_logged(self):
        captured = self.capture()
        secret = 'sk-or-private-example-never-log'
        try:
            raise RuntimeError(secret + ' user@example.test Authorization: Bearer password')
        except RuntimeError as exc:
            diagnostics.log_event('patient-response-failed', request_id=secret + '\nFORGED', category=secret,
                                  error=exc, status=429, retryable=True)
        event = self.events(captured)[0]
        self.assertNotIn(secret, captured.output[0])
        self.assertNotIn('user@example.test', captured.output[0])
        self.assertNotIn('FORGED', captured.output[0])
        self.assertTrue(event['requestId'].startswith('sha256:'))
        self.assertEqual(event['category'], 'unclassified')
        self.assertEqual(event['exceptionType'], 'RuntimeError')
        self.assertTrue(event['stack'])
        self.assertEqual(event['upstreamStatus'], 429)

    def test_broken_terminal_and_nonstandard_ids_do_not_change_failure_handling(self):
        with patch.object(diagnostics._logger, 'log', side_effect=OSError('broken terminal')):
            diagnostics.log_event('patient-response-failed', request_id='unusual-id-\ud800', category='rate-limited')

    def test_http_errors_log_templates_not_credentials_or_paths_and_preserve_contract(self):
        captured = self.capture()
        app = create_application(RuntimeSettings('', ['http://localhost:5173'], {'http://localhost:5173'}, development_access=True),
                                 Limiter(key_func=get_remote_address))
        @app.get('/resource/{item_id}')
        async def missing(item_id: str):
            raise HTTPException(404, detail='private detail ' + item_id)
        client = TestClient(app, headers={'Origin': 'http://localhost:5173'})
        response = client.get('/resource/private-user-id?token=hidden', headers={'Authorization': 'Bearer hidden'})
        self.assertEqual((response.status_code, response.json()), (404, {'detail': 'private detail private-user-id'}))
        event = self.events(captured)[-1]
        self.assertEqual(event['event'], 'http-request-rejected')
        self.assertEqual(event['route'], '/resource/{item_id}')
        self.assertEqual(event['httpStatus'], 404)
        self.assertNotIn('private-user-id', str(event))
        self.assertNotIn('hidden', str(event))
        self.assertNotIn('X-MedSim-Diagnostic-Id', response.headers)
        denied = TestClient(app).get('/unknown-private-path?token=secret')
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(self.events(captured)[-1]['route'], '<unmatched>')

    def test_uncaught_http_and_stream_exceptions_are_logged_and_still_propagate(self):
        captured = self.capture()
        app = create_application(RuntimeSettings('', [], {'http://localhost:5173'}, development_access=True), Limiter(key_func=get_remote_address))
        @app.get('/boom')
        async def boom():
            raise RuntimeError('never-log-this-exception-body')
        @app.get('/broken-stream')
        async def broken_stream():
            async def chunks():
                yield b'data: partial\n\n'
                raise RuntimeError('never-log-this-exception-body')
            return StreamingResponse(chunks(), media_type='text/event-stream')
        client = TestClient(app, headers={'Origin': 'http://localhost:5173'})
        for path in ('/boom', '/broken-stream'):
            with self.assertRaises(Exception):
                client.get(path)
        errors = [event for event in self.events(captured) if event['event'] == 'http-request-failed']
        self.assertEqual(len(errors), 2)
        self.assertNotIn('never-log-this-exception-body', str(errors))
        self.assertTrue(all(event['stack'] for event in errors))

    def test_success_is_quiet_and_request_context_does_not_leak(self):
        captured = self.capture()
        app = create_application(RuntimeSettings('', [], {'http://localhost:5173'}, development_access=True), Limiter(key_func=get_remote_address))
        @app.get('/ok')
        async def ok():
            return {'ok': True}
        @app.get('/rejected')
        async def rejected():
            raise HTTPException(422, 'unchanged')
        client = TestClient(app, headers={'Origin': 'http://localhost:5173'})
        self.assertEqual(client.get('/ok').json(), {'ok': True})
        client.get('/rejected')
        client.get('/rejected')
        events = self.events(captured)
        self.assertEqual(len(events), 2)
        self.assertNotEqual(events[0]['serverRequestId'], events[1]['serverRequestId'])
        diagnostics.log_event('tts-preload-failed')
        self.assertNotIn('serverRequestId', self.events(captured)[-1])

    def test_background_exception_handler_is_safe_and_restored(self):
        captured = self.capture()
        async def run():
            loop = asyncio.get_running_loop()
            before = loop.get_exception_handler()
            with patch('medsim_backend.application.get_tts_manager') as manager:
                manager.return_value.start_background_preload.return_value = None
                async with lifespan(None):
                    loop.call_exception_handler({'message': 'secret task message', 'exception': RuntimeError('secret exception')})
            self.assertIs(loop.get_exception_handler(), before)
        asyncio.run(run())
        event = next(e for e in self.events(captured) if e['event'] == 'background-task-failed')
        self.assertEqual(event['exceptionType'], 'RuntimeError')
        self.assertNotIn('secret', str(event))

    def test_preload_failures_are_visible_without_loading_models(self):
        captured = self.capture()
        async def run():
            manager = TTSManager(load_tts_settings({}))
            with patch('tts.providers.inspect_kokoro_cache', return_value=SimpleNamespace(ready=False, state='tts-model-missing')):
                await manager._prepare_startup_audio()
            self.assertEqual(manager._error_category, 'tts-model-missing')
            with patch.object(manager, 'provider', side_effect=RuntimeError('hidden-model-path')):
                await manager._preload_kokoro()
            self.assertEqual(manager._error_category, 'tts-initialization-failed')
            with patch('medsim_backend.application.get_tts_manager', side_effect=TTSConfigurationError('hidden-env-value')):
                async with lifespan(None):
                    pass
        asyncio.run(run())
        events = self.events(captured)
        self.assertIn('tts-model-missing', [event.get('category') for event in events])
        self.assertIn('tts-initialization-failed', [event.get('category') for event in events])
        self.assertNotIn('hidden-', str(events))

    def test_concurrent_streams_keep_separate_contexts_without_changing_frames(self):
        captured = self.capture()
        async def run():
            async def app(scope, receive, send):
                await asyncio.sleep(0)
                diagnostics.log_event('patient-response-failed', category='response-timeout')
                await send({'type': 'http.response.start', 'status': 200, 'headers': []})
                await asyncio.sleep(0)
                await send({'type': 'http.response.body', 'body': b'data: unchanged\n\n'})
                diagnostics.log_event('patient-response-failed', category='response-timeout')
            middleware = diagnostics.DiagnosticMiddleware(app)
            async def request():
                messages = []
                async def send(message):
                    messages.append(message)
                await middleware({'type': 'http', 'method': 'POST'}, AsyncMock(), send)
                self.assertEqual(messages[-1]['body'], b'data: unchanged\n\n')
            await asyncio.gather(request(), request())
        asyncio.run(run())
        events = self.events(captured)
        from collections import Counter
        self.assertEqual(sorted(Counter(e['serverRequestId'] for e in events).values()), [2, 2])

    def test_startup_exception_is_logged_and_propagated_with_handler_restored(self):
        captured = self.capture()
        async def run():
            loop = asyncio.get_running_loop()
            previous = loop.get_exception_handler()
            with patch('medsim_backend.application.get_tts_manager', side_effect=RuntimeError('private startup message')):
                with self.assertRaises(RuntimeError):
                    async with lifespan(None):
                        self.fail('Startup unexpectedly succeeded')
            self.assertIs(loop.get_exception_handler(), previous)
        asyncio.run(run())
        event = next(e for e in self.events(captured) if e['event'] == 'backend-lifecycle-failed')
        self.assertNotIn('private startup message', str(event))


class EndpointDiagnosticTests(DiagnosticCapture, unittest.TestCase):
    def setUp(self):
        server.limiter.reset()
        self.addCleanup(server.limiter.reset)
        self.client = TestClient(server.app, headers={'Origin': 'http://localhost:5173'})
        self.case = server.LOCAL_AI_CASES['id-004']
        response = self.client.post('/api/attempts', json={'caseId': 'id-004', 'caseVersion': self.case['caseVersion']})
        self.aid = response.json()['attemptId']
        self.attempt = server._INVESTIGATION_ATTEMPTS[self.aid]
        self.addCleanup(server._INVESTIGATION_ATTEMPTS.pop, self.aid, None)

    def test_sse_provider_errors_are_logged_even_with_http_200_and_keep_evidence_empty(self):
        captured = self.capture()
        request_id = 'fdc6de71-41be-4aa2-838c-a9aa0c12527b'
        provider = AsyncMock()
        cases = [('rate-limited', 429), ('response-timeout', None), ('configuration-invalid', 401)]
        with patch.dict('os.environ', {'MEDSIM_SEMANTIC_DIALOGUE_ENABLED': 'true'}), patch.object(dialogue, 'get_local_llm_provider', return_value=provider):
            for category, status in cases:
                provider.complete_chat.side_effect = LLMProviderError(category, 'private-provider-body', True, status)
                response = self.client.post('/agent/patient/stream', json={'attemptId': self.aid, 'source': 'typed',
                    'question': 'Tell me about those marks after your outdoor weekend.', 'requestId': request_id})
                self.assertEqual(response.status_code, 200)
                self.assertIn('"category":"' + category + '"', response.text)
                event = self.events(captured)[-1]
                self.assertEqual(event['event'], 'patient-response-failed')
                self.assertEqual(event['category'], category)
                self.assertEqual(event['requestId'], request_id)
                self.assertEqual(event.get('upstreamStatus'), status)
        self.assertEqual(len(self.attempt['transcript']), 1)
        self.assertFalse(self.attempt['patientResponses'])
        self.assertFalse(self.attempt['patientRequestActive'])
        self.assertNotIn('private-provider-body', str(self.events(captured)))

    def test_invalid_semantic_output_is_distinguishable_from_provider_failure(self):
        from local_llm import ChatCompletion
        captured = self.capture()
        provider = AsyncMock()
        provider.complete_chat.return_value = ChatCompletion('private invalid JSON', 'fixture', 'fixture', 0, ('fixture',))
        with patch.dict('os.environ', {'MEDSIM_SEMANTIC_DIALOGUE_ENABLED': 'true'}), patch.object(dialogue, 'get_local_llm_provider', return_value=provider):
            response = self.client.post('/agent/patient/stream', json={'attemptId': self.aid, 'source': 'typed',
                'question': 'Tell me about those marks after your outdoor weekend.'})
        self.assertIn('"error":', response.text)
        self.assertEqual(self.events(captured)[-1]['validation'], 'invalid-semantic-json')
        self.assertNotIn('private invalid JSON', str(self.events(captured)))

    def test_evaluation_fallback_is_logged_but_still_returns_deterministic_result(self):
        captured = self.capture()
        provider = AsyncMock()
        provider.health.side_effect = LLMProviderError('rate-limited', 'private evaluation response', True, 429)
        with patch.object(evaluation, 'get_local_llm_provider', return_value=provider):
            response = self.client.post('/api/local-ai/evaluate', json={'attemptId': self.aid, 'caseId': 'id-004',
                'caseVersion': self.case['caseVersion']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['generation']['error_category'], 'rate-limited')
        event = next(e for e in self.events(captured) if e['event'] == 'evaluation-fallback')
        self.assertEqual(event['category'], 'rate-limited')
        self.assertEqual(event['upstreamStatus'], 429)
        self.assertNotIn('private evaluation response', str(event))

    def test_tts_failure_is_logged_with_request_id_without_speech_or_model_loading(self):
        captured = self.capture()
        manager = AsyncMock()
        manager.synthesize.side_effect = TTSProviderError('original safe response')
        request_id = 'fdc6de71-41be-4aa2-838c-a9aa0c12527b'
        with patch('medsim_backend.routes.diagnostics.get_tts_manager', return_value=manager):
            response = self.client.post('/tts/synthesize', json={'text': 'private patient speech', 'attemptId': self.aid,
                'caseId': 'id-004', 'caseVersion': self.case['caseVersion'], 'requestId': request_id})
        self.assertEqual((response.status_code, response.json()), (503, {'detail': 'original safe response'}))
        event = next(e for e in self.events(captured) if e['event'] == 'tts-response-failed')
        self.assertEqual(event['requestId'], request_id)
        self.assertNotIn('private patient speech', str(self.events(captured)))

    def test_attempt_audio_background_failure_is_observed_and_task_is_removed(self):
        captured = self.capture()
        from medsim_backend.services.attempt_service import AttemptService
        async def run():
            service = AttemptService(None, {}, {}, SimpleNamespace(provider='kokoro'))
            with patch.object(service, 'prepare_case_audio', side_effect=RuntimeError('private background data')):
                service.schedule_case_audio({}, {})
                await asyncio.sleep(0)
                await asyncio.sleep(0)
            self.assertFalse(service._tts_prepare_tasks)
        asyncio.run(run())
        self.assertEqual(self.events(captured)[-1]['event'], 'tts-preparation-failed')
        self.assertNotIn('private background data', str(self.events(captured)))

"""Offline startup trust preparation: no sockets, inference or private config."""
import asyncio
import json
import os
import socket
import ssl
import tempfile
import traceback
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from hosted_dialogue_diagnostic import CompletionBudget, instrument_provider, trial
from local_llm import LLMProviderError, LocalLLMSettings, OpenRouterLLMProvider, SerializingLocalLLMProvider, build_provider

MODEL = 'nvidia/nemotron-3.5-super-vl:free'
PRIVATE = 'private-certificate-path-must-not-be-logged'


class StartupTrustTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(patch.dict(os.environ, {
            'MEDSIM_DATABASE_PATH': str(Path(directory.name) / 'test.db'),
            'MEDSIM_PILOT_MODE': '0', 'MEDSIM_ENVIRONMENT': 'development', 'RENDER': 'false',
            'MEDSIM_SEMANTIC_DIALOGUE_ENABLED': 'true', 'PATIENT_TTS_PROVIDER': 'disabled',
            'PATIENT_TTS_FALLBACK': 'disabled',
        }))
        from medsim_backend.runtime import create_runtime
        self.runtime = create_runtime()
        self.configured = LocalLLMSettings(patient_model=MODEL, api_key='offline-only')
        self.delegate = OpenRouterLLMProvider(self.configured)
        self.owner = SerializingLocalLLMProvider(self.delegate)
        self.runtime.app.state.provider_factory = lambda: self.owner
        self.tts = self.enterContext(patch('medsim_backend.application.get_tts_manager',
            return_value=Mock(start_background_preload=Mock(return_value=None))))

    async def test_real_verified_context_preparation_is_local_and_keeps_the_client_lazy(self):
        with patch('local_llm.httpx.AsyncClient') as client, \
                patch.object(socket, 'getaddrinfo', side_effect=AssertionError('startup DNS')) as dns, \
                patch.object(socket.socket, 'connect', side_effect=AssertionError('startup connect')) as connect, \
                patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('startup connect_ex')) as connect_ex:
            async with self.runtime.app.router.lifespan_context(self.runtime.app):
                self.assertTrue(self.delegate._ssl_context.check_hostname)
                self.assertEqual(self.delegate._ssl_context.verify_mode, ssl.CERT_REQUIRED)
                self.assertGreaterEqual(self.delegate.tls_preparation_ms, 0)
                self.assertIsNone(self.delegate._pooled_client)
                self.assertIs(self.owner._owner_loop, asyncio.get_running_loop())
            client.assert_not_called()
            dns.assert_not_called()
            connect.assert_not_called()
            connect_ex.assert_not_called()

    async def test_startup_has_zero_network_or_clients_and_first_real_route_uses_prepared_context(self):
        verified = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        requests, client_contexts = [], []
        original_client = httpx.AsyncClient

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={'model': MODEL, 'choices': [{'message': {
                'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]})

        def client(**kwargs):
            if 'verify' in kwargs:
                client_contexts.append(kwargs['verify'])
                kwargs['transport'] = httpx.MockTransport(handler)
            return original_client(**kwargs)

        budget = CompletionBudget()
        instrument_provider(self.delegate, budget)
        with patch('local_llm.httpx.create_ssl_context', return_value=verified) as prepare, \
                patch('local_llm.httpx.AsyncClient', side_effect=client) as clients, \
                patch.object(socket, 'getaddrinfo', side_effect=AssertionError('startup DNS')) as dns, \
                patch.object(socket.socket, 'connect', side_effect=AssertionError('startup connect')) as connect, \
                patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('startup connect_ex')) as connect_ex:
            async with self.runtime.app.router.lifespan_context(self.runtime.app):
                prepare.assert_called_once_with()
                clients.assert_not_called()
                self.assertIs(self.delegate._ssl_context, verified)
                self.assertIsNone(self.delegate._pooled_client)
                self.assertEqual((budget.used, len(requests)), (0, 0))
                rows = [await trial(self.runtime, self.delegate, self.owner, self.configured, label,
                                    application_owned=True) for label in ('cold', 'pool-eligible')]
                prepare.assert_called_once_with()
                pooled_client = self.delegate._pooled_client
                self.assertFalse(pooled_client.is_closed)
            dns.assert_not_called()
            connect.assert_not_called()
            connect_ex.assert_not_called()
        self.assertEqual(client_contexts, [verified])
        self.assertTrue(verified.check_hostname)
        self.assertEqual(verified.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual((budget.used, len(requests)), (2, 2))
        self.assertTrue(all(request.url.path == '/api/v1/chat/completions' and request.method == 'POST' for request in requests))
        self.assertTrue(all(row['groundedAnswerAndDone'] and row['upstreamModelIdentityConfirmed'] for row in rows))
        self.assertEqual([request.extensions['timeout']['read'] for request in requests], [3.0, 3.0])
        self.assertTrue(pooled_client.is_closed)
        self.assertIsNone(self.owner._owner_loop)

    async def test_missing_certificate_file_aborts_startup_with_safe_error_and_restores_ownership(self):
        previous_handler = asyncio.get_running_loop().get_exception_handler()
        invalid_path = str(Path(tempfile.gettempdir()) / PRIVATE / 'nonexistent-ca.pem')
        with patch.dict(os.environ, {'SSL_CERT_FILE': invalid_path}), \
                patch('local_llm.httpx.AsyncClient') as client, \
                self.assertLogs('medsim.diagnostics', level='INFO') as captured:
            with self.assertRaises(LLMProviderError) as raised:
                async with self.runtime.app.router.lifespan_context(self.runtime.app):
                    self.fail('Invalid certificate startup succeeded')
        self.assertEqual(raised.exception.category, 'configuration-invalid')
        self.assertFalse(raised.exception.retryable)
        self.assertIn('Hosted TLS trust preparation failed', str(raised.exception))
        self.assertNotIn(PRIVATE, ''.join(traceback.format_exception(raised.exception)))
        event = next(json.loads(record.getMessage()) for record in captured.records
                     if json.loads(record.getMessage())['event'] == 'backend-lifecycle-failed')
        self.assertEqual(event['category'], 'configuration-invalid')
        self.assertNotIn(PRIVATE, json.dumps(event))
        self.assertIs(asyncio.get_running_loop().get_exception_handler(), previous_handler)
        self.assertIsNone(self.owner._owner_loop)
        self.assertIsNone(self.delegate._pool_loop)
        self.assertIsNone(getattr(self.runtime.app.state, 'llm_provider', None))
        self.assertTrue(self.owner._closing)
        self.tts.assert_not_called()
        client.assert_not_called()
        with self.assertRaises(LLMProviderError):
            await self.owner.complete_chat(None)

    async def test_unverified_contexts_are_rejected_without_a_client_or_fallback(self):
        for mode in (ssl.CERT_REQUIRED, ssl.CERT_NONE):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = mode
            with self.subTest(mode=mode), patch('local_llm.httpx.create_ssl_context', return_value=context), \
                    patch('local_llm.httpx.AsyncClient') as client:
                with self.assertRaises(LLMProviderError):
                    async with self.owner.lifespan():
                        self.fail('Unverified context accepted')
                client.assert_not_called()
                self.assertIsNone(self.delegate._ssl_context)
                self.assertIsNone(self.delegate._pool_loop)
                self.assertTrue(self.owner._closing)

    async def test_repeated_application_lifecycles_get_fresh_preparation_and_certificate_environment(self):
        delegates, observed_environment = [], []

        def factory():
            delegate = OpenRouterLLMProvider(self.configured)
            delegates.append(delegate)
            return SerializingLocalLLMProvider(delegate)

        def context():
            observed_environment.append((os.environ.get('SSL_CERT_FILE'), os.environ.get('SSL_CERT_DIR')))
            return ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

        self.runtime.app.state.provider_factory = factory
        with patch('local_llm.httpx.create_ssl_context', side_effect=context), patch('local_llm.httpx.AsyncClient') as client:
            for index in (1, 2):
                with patch.dict(os.environ, {'SSL_CERT_FILE': f'fixture-{index}.pem', 'SSL_CERT_DIR': f'fixture-dir-{index}'}):
                    async with self.runtime.app.router.lifespan_context(self.runtime.app):
                        self.assertIsNotNone(delegates[-1]._ssl_context)
                        self.assertIsNone(delegates[-1]._pooled_client)
            client.assert_not_called()
        self.assertEqual(observed_environment, [('fixture-1.pem', 'fixture-dir-1'), ('fixture-2.pem', 'fixture-dir-2')])
        self.assertIsNot(delegates[0]._ssl_context, delegates[1]._ssl_context)

    async def test_local_and_injected_transport_lifespans_do_not_prepare_hosted_trust_or_start_models(self):
        local = replace(self.configured, provider='llama_cpp', base_url='http://127.0.0.1:8080/v1')
        delegates = [build_provider(local), build_provider(replace(local, local_llm_enabled=True)),
                     OpenRouterLLMProvider(self.configured, httpx.MockTransport(lambda request: httpx.Response(500)))]
        with patch('local_llm.httpx.create_ssl_context') as prepare, patch('local_llm.httpx.AsyncClient') as client:
            for delegate in delegates:
                async with SerializingLocalLLMProvider(delegate).lifespan():
                    pass
            prepare.assert_not_called()
            client.assert_not_called()

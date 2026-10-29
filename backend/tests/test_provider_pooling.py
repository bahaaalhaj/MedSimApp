"""Offline lifecycle tests: real loopback HTTP keep-alive and scripted SSE errors."""
import asyncio
import json
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_llm import (
    ChatRequest, LLMProviderError, LocalLLMSettings, OpenRouterLLMProvider,
    SerializingLocalLLMProvider, StructuredRequest, get_local_llm_provider,
)
from medsim_backend.application import create_application
from medsim_backend.config import RuntimeSettings
from slowapi import Limiter
from slowapi.util import get_remote_address

MODEL = 'nvidia/nemotron-3.5-super-vl:free'


def configured():
    return LocalLLMSettings(patient_model=MODEL, api_key='offline-fixture-key', max_retries=0)


def question(request_id='first'):
    return ChatRequest('fixture', [{'role': 'user', 'content': request_id}], 80, request_id=request_id)


class LoopbackPoolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests, self.connections, self.writers = [], 0, set()
        self.hold_first = self.close_idle_first = False
        self.drop_at = None
        self.received = asyncio.Event()
        self.disconnected = asyncio.Event()
        self.server = await asyncio.start_server(self.handle, '127.0.0.1', 0)
        port = self.server.sockets[0].getsockname()[1]
        self.delegate = OpenRouterLLMProvider(replace(configured(), base_url=f'http://127.0.0.1:{port}/api/v1'))
        self.provider = SerializingLocalLLMProvider(self.delegate)

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        for writer in list(self.writers):
            writer.close()
            await writer.wait_closed()

    async def handle(self, reader, writer):
        self.connections += 1
        self.writers.add(writer)
        try:
            while True:
                raw = await reader.readuntil(b'\r\n\r\n')
                lines = raw.decode().split('\r\n')
                headers = dict(line.split(': ', 1) for line in lines[1:] if ': ' in line)
                headers = {key.lower(): value for key, value in headers.items()}
                payload = json.loads(await reader.readexactly(int(headers['content-length'])))
                self.requests.append((headers, payload))
                self.received.set()
                if len(self.requests) == self.drop_at:
                    return  # Stale/failed connection after dispatch: never replay.
                body = json.dumps({'model': MODEL, 'choices': [{'message': {'content': '{}'}}]}).encode()
                writer.write(f'HTTP/1.1 200 OK\r\nContent-Length: {len(body)}\r\nSet-Cookie: learner=first; Path=/\r\n\r\n'.encode())
                if len(self.requests) == 1 and self.hold_first:
                    writer.write(body[:1])
                    await writer.drain()
                    await reader.read()  # Cancellation must close the partial response.
                    self.disconnected.set()
                    return
                writer.write(body)
                await writer.drain()
                if len(self.requests) == 1 and self.close_idle_first:
                    return
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            self.writers.discard(writer)
            writer.close()
            await writer.wait_closed()

    async def test_reuses_one_real_connection_with_request_deadlines_and_no_cookie_or_identity_carryover(self):
        async with self.provider.lifespan():
            self.assertIsNone(self.delegate._pooled_client)
            await self.provider.complete_chat(question('learner-one'))
            client = self.delegate._pooled_client
            await self.provider.structured_completion(StructuredRequest('fixture', 'learner-two', 80, request_id='second'), {})
            self.assertIs(client, self.delegate._pooled_client)
            self.assertFalse(client.is_closed)
            self.assertFalse(list(client.cookies.jar))
        self.assertTrue(client.is_closed)
        self.assertEqual((len(self.requests), self.connections), (2, 1))
        self.assertEqual([headers['x-request-id'] for headers, _ in self.requests], ['learner-one', 'second'])
        self.assertTrue(all('cookie' not in headers for headers, _ in self.requests))
        self.assertNotIn('learner-one', json.dumps(self.requests[1][1]))
        self.assertTrue(all(payload['provider']['max_price'] == {'prompt': 0, 'completion': 0, 'request': 0}
                            and payload['model'] == MODEL for _, payload in self.requests))

    async def test_cancellation_closes_partial_body_releases_gate_and_never_dispatches_cancelled_waiter(self):
        self.hold_first = True
        async with self.provider.lifespan():
            first = asyncio.create_task(self.provider.complete_chat(question()))
            await asyncio.wait_for(self.received.wait(), 2)
            queued = asyncio.create_task(self.provider.complete_chat(question('queued')))
            await asyncio.sleep(0)
            queued.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await queued
            self.assertEqual(len(self.requests), 1)
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            await asyncio.wait_for(self.disconnected.wait(), 2)
            await self.provider.complete_chat(question('manual-next-turn'))
        self.assertEqual(len(self.requests), 2)
        self.assertFalse(self.provider._calls)

    async def test_shutdown_cancels_active_and_queued_calls_before_closing_pool(self):
        self.hold_first = True
        async with self.provider.lifespan():
            first = asyncio.create_task(self.provider.complete_chat(question()))
            await asyncio.wait_for(self.received.wait(), 2)
            queued = asyncio.create_task(self.provider.complete_chat(question('queued')))
            await asyncio.sleep(0)
            client = self.delegate._pooled_client
        self.assertTrue(first.cancelled())
        self.assertTrue(queued.cancelled())
        self.assertTrue(client.is_closed)
        self.assertEqual(len(self.requests), 1)
        with self.assertRaises(LLMProviderError):
            await self.provider.complete_chat(question('after-shutdown'))

    async def test_stale_socket_failure_is_reported_once_and_only_manual_next_call_dispatches_again(self):
        self.drop_at = 2
        async with self.provider.lifespan():
            await self.provider.complete_chat(question('initial-success'))
            with self.assertRaises(LLMProviderError) as error:
                await self.provider.complete_chat(question())
            self.assertEqual(error.exception.category, 'model-unavailable')
            self.assertEqual((len(self.requests), self.connections), (2, 1))
            await self.provider.complete_chat(question('manual'))
        self.assertEqual((len(self.requests), self.connections), (3, 2))

    async def test_detected_idle_peer_disconnect_opens_a_new_connection_without_duplicate_posts(self):
        self.close_idle_first = True
        async with self.provider.lifespan():
            await self.provider.complete_chat(question('first'))
            await asyncio.sleep(.01)
            await self.provider.complete_chat(question('second'))
        self.assertEqual((len(self.requests), self.connections), (2, 2))

    async def test_original_absolute_deadline_also_applies_to_a_pooled_body_read(self):
        self.hold_first = True
        # Warm only the trust store offline, then exercise a bounded test instance.
        await self.delegate._client(3).aclose()
        self.delegate.settings = replace(self.delegate.settings, patient_timeout_seconds=.5)
        async with self.provider.lifespan():
            with self.assertRaises(LLMProviderError) as error:
                await self.provider.complete_chat(question())
            self.assertEqual(error.exception.category, 'response-timeout')
            await asyncio.wait_for(self.disconnected.wait(), 2)
        self.assertEqual(len(self.requests), 1)

    async def test_cross_loop_access_fails_before_dispatch(self):
        async with self.provider.lifespan():
            def foreign_loop():
                return asyncio.run(self.provider.complete_chat(question()))
            with self.assertRaises(LLMProviderError):
                await asyncio.to_thread(foreign_loop)
        self.assertFalse(self.requests)


class ApplicationPoolTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalogue_readiness_uses_a_separate_short_lived_client_from_completion_pool(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def handler(request):
            if request.url.path.endswith('/models'):
                started.set()
                await release.wait()
                return httpx.Response(200, json={'data': [{'id': MODEL,
                    'pricing': {'prompt': '0', 'completion': '0'}, 'supported_parameters': ['reasoning']}]})
            return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}]})
        delegate = OpenRouterLLMProvider(configured(), httpx.MockTransport(handler))
        provider = SerializingLocalLLMProvider(delegate)
        clients = []
        original = delegate._client
        def client(timeout):
            result = original(timeout)
            clients.append(result)
            return result
        delegate._client = client
        async with provider.lifespan():
            readiness = asyncio.create_task(provider.health())
            await asyncio.wait_for(started.wait(), 2)
            await provider.complete_chat(question())
            self.assertEqual(len(clients), 2)
            self.assertIs(delegate._pooled_client, clients[1])
            release.set()
            self.assertEqual((await readiness).state, 'ready')
            self.assertTrue(clients[0].is_closed)
            self.assertFalse(clients[1].is_closed)
        self.assertTrue(clients[1].is_closed)

    async def test_separate_apps_have_separate_clients_and_shutdown_does_not_close_another_app(self):
        delegates, wrappers = [], []
        def factory():
            delegate = OpenRouterLLMProvider(configured(), httpx.MockTransport(
                lambda request: httpx.Response(200, json={'model': MODEL, 'choices': [{'message': {'content': '{}'}}]})))
            delegates.append(delegate)
            wrapper = SerializingLocalLLMProvider(delegate)
            wrappers.append(wrapper)
            return wrapper
        def app():
            settings = RuntimeSettings('', ['http://localhost:5173'], {'http://localhost:5173'}, True)
            result = create_application(settings, Limiter(key_func=get_remote_address), provider_factory=factory)
            @result.get('/probe')
            async def probe():
                provider = get_local_llm_provider()
                await provider.complete_chat(question())
                return {'owner': id(provider)}
            return result
        one, two = app(), app()
        fallback = get_local_llm_provider()
        async def probe(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost',
                                         headers={'Origin': 'http://localhost:5173'}) as client:
                response = await client.get('/probe')
                self.assertEqual(response.status_code, 200, response.text)
                return response.json()['owner']
        with patch('medsim_backend.application.get_tts_manager', return_value=Mock(start_background_preload=Mock(return_value=None))):
            async with one.router.lifespan_context(one):
                first = await probe(one)
                client_one = delegates[0]._pooled_client
                with self.assertRaisesRegex(RuntimeError, 'already has an active'):
                    async with one.router.lifespan_context(one):
                        self.fail('Overlapping ownership of one app was accepted')
                self.assertFalse(client_one.is_closed)
                async with two.router.lifespan_context(two):
                    second = await probe(two)
                    client_two = delegates[1]._pooled_client
                    self.assertNotEqual(first, second)
                    self.assertIsNot(client_one, client_two)
                    self.assertIs(get_local_llm_provider(), fallback)
                self.assertTrue(client_two.is_closed)
                self.assertFalse(client_one.is_closed)
                self.assertEqual(await probe(one), first)
            self.assertTrue(client_one.is_closed)
            async with one.router.lifespan_context(one):
                self.assertNotEqual(await probe(one), first)
        self.assertTrue(all(wrapper._closing for wrapper in wrappers))


class StandalonePoolTests(unittest.TestCase):
    def test_repeated_asyncio_run_scopes_and_unmanaged_calls_never_reuse_closed_clients_or_bound_gates(self):
        clients = []
        async def handler(request):
            await asyncio.sleep(.001)
            return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}]})
        delegate = OpenRouterLLMProvider(configured(), httpx.MockTransport(handler))
        provider = SerializingLocalLLMProvider(delegate)
        original = delegate._client
        def client(timeout):
            value = original(timeout)
            clients.append(value)
            return value
        delegate._client = client
        async def unmanaged():
            await asyncio.gather(provider.complete_chat(question()), provider.complete_chat(question()))
        asyncio.run(unmanaged())
        asyncio.run(unmanaged())
        self.assertEqual(len(clients), 4)
        self.assertTrue(all(client.is_closed for client in clients))
        async def managed():
            async with provider.lifespan():
                await asyncio.gather(provider.complete_chat(question()), provider.complete_chat(question()))
        asyncio.run(managed())
        asyncio.run(managed())
        self.assertEqual(len(clients), 6)
        self.assertEqual(len({id(client) for client in clients}), 6)
        self.assertTrue(all(client.is_closed for client in clients))

    def test_per_request_timeouts_are_not_inherited_from_first_pooled_call(self):
        timeouts = []
        def handler(request):
            timeouts.append(request.extensions['timeout']['read'])
            return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}]})
        provider = SerializingLocalLLMProvider(OpenRouterLLMProvider(configured(), httpx.MockTransport(handler)))
        async def run():
            async with provider.lifespan():
                await provider.structured_completion(StructuredRequest('f', 'f', 80), {})
                await provider.complete_chat(question())
        asyncio.run(run())
        self.assertEqual(timeouts, [7, 3])

    def test_real_app_sse_protocol_failure_keeps_http_200_but_never_commits_or_emits_done(self):
        from test_support import TestClient
        calls = []
        def fail(request):
            calls.append(request)
            raise httpx.RemoteProtocolError('offline dropped connection')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                'MEDSIM_DATABASE_PATH': str(Path(directory)/'accounts.db'), 'MEDSIM_SEMANTIC_DIALOGUE_ENABLED': 'true'}):
            from medsim_backend.runtime import create_runtime
            runtime = create_runtime()
            runtime.app.state.provider_factory = lambda: SerializingLocalLLMProvider(
                OpenRouterLLMProvider(configured(), httpx.MockTransport(fail)))
            with patch('medsim_backend.application.get_tts_manager', return_value=Mock(start_background_preload=Mock(return_value=None))), TestClient(runtime.app, headers={'Origin': 'http://localhost:5173'}) as client:
                from local_ai import LOCAL_AI_CASES
                case = LOCAL_AI_CASES['id-004']
                attempt = client.post('/api/attempts', json={'caseId': 'id-004', 'caseVersion': case['caseVersion']}).json()['attemptId']
                current = runtime.attempt_store.attempts[attempt]
                before = list(current['transcript'])
                response = client.post('/agent/patient/stream', json={'attemptId': attempt, 'source': 'typed',
                    'question': 'Tell me about those marks after your outdoor weekend.', 'requestId': 'pool-sse-failure'})
                frames = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
                self.assertEqual(response.status_code, 200)
                self.assertEqual(frames[-1]['category'], 'model-unavailable')
                self.assertTrue(frames[-1]['retryable'])
                self.assertFalse(any(frame.get('done') or 'text' in frame for frame in frames))
                self.assertEqual(len(calls), 1)
                self.assertEqual(current['transcript'], before)
                self.assertFalse(current['askedQuestionIds'])
                self.assertFalse(current['patientResponses'])
                self.assertFalse(current['patientRequestActive'])

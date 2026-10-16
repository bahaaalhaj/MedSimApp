"""Offline regression tests; no weights, TTS, or hosted inference are loaded."""
import asyncio
import json
import math
import sys
import unittest
import threading
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace
from contextlib import ExitStack

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_llm import (ChatCompletion, ChatRequest, LocalLLMSettings,
                       OpenAICompatibleLocalProvider, SerializingLocalLLMProvider)
from medsim_backend.services import patient_dialogue_service as dialogue
from medsim_backend.schemas import PatientTurnRequest
from local_ai import LOCAL_AI_CASES
from semantic_dialogue_smoke import provider_readiness, run_probes, offline_connections


class LocalDeadlineTests(unittest.TestCase):
    def test_smoke_requires_identity_readiness_and_memory_safety(self):
        health={'local_ai':{'provider':'llama_cpp','state':'ready','safety_status':'safe'}}
        self.assertIsNone(provider_readiness(health,'llama_cpp'))
        self.assertEqual(provider_readiness(health,'openrouter'),'provider-mismatch')
        health['local_ai']['safety_status']='unsafe-low-memory'
        self.assertEqual(provider_readiness(health,'llama_cpp'),'unsafe-low-memory')
        health['local_ai'].update(safety_status='safe',state='loading',last_error_category='model-starting')
        self.assertEqual(provider_readiness(health,'llama_cpp'),'model-starting')

    def test_smoke_counts_local_model_without_calling_it_hosted(self):
        def handler(request):
            if request.url.path=='/api/attempts':
                return httpx.Response(201,json={'attemptId':'smoke-local-attempt-1234'})
            return httpx.Response(200,text='data: {"text":"Three pillows."}\n\ndata: {"done":true,"provenance":"openrouter","actualModel":"local-qwen"}\n\n')
        with httpx.Client(base_url='http://127.0.0.1:8787',transport=httpx.MockTransport(handler)) as client, patch('semantic_dialogue_smoke.gpu_sample',return_value=None):
            report=run_probes(client,[('card-003','Novel wording',('pillows',))],{'provider':'llama_cpp','model':'local-qwen'})
        self.assertEqual(report['passed'],1)
        self.assertEqual(report['modelTurns'],1)
        self.assertEqual(report['hostedTurns'],0)
        self.assertIsNone(report['results'][0]['selectedSourceIds'])

    def test_offline_guard_blocks_external_dns_before_a_connection(self):
        import socket
        with ExitStack() as stack:
            offline_connections(stack)
            self.assertTrue(socket.getaddrinfo(b'127.0.0.1',8080))
            with self.assertRaises(OSError):
                socket.getaddrinfo('example.com',443)
            with socket.socket() as connection, self.assertRaises(OSError):
                connection.connect(('8.8.8.8',443))

    def test_local_budget_is_separate_from_unchanged_hosted_budget(self):
        local = LocalLLMSettings(provider="llama_cpp", base_url="http://127.0.0.1:8080/v1")
        with patch.object(dialogue, "llm_settings", return_value=local):
            self.assertEqual(dialogue.semantic_timeout_seconds(), 12.0)
        with patch.object(dialogue, "llm_settings", return_value=LocalLLMSettings()):
            self.assertEqual(dialogue.semantic_timeout_seconds(), 3.2)
        self.assertEqual(LocalLLMSettings().patient_timeout_seconds, 3.0)

    def test_local_budget_has_finite_bounds_and_environment_setting(self):
        for value in (0, 0.9, 30.1, math.inf, math.nan):
            with self.subTest(value=value), self.assertRaises(ValueError):
                replace(LocalLLMSettings(), local_interpretation_timeout_seconds=value).validate()
        with patch.dict("os.environ", {"MEDSIM_LLM_PROVIDER": "llama_cpp",
                        "MEDSIM_LOCAL_LLM_ENABLED": "true",
                        "MEDSIM_LOCAL_INTERPRETATION_TIMEOUT_SECONDS": "9"}, clear=True):
            self.assertEqual(LocalLLMSettings.from_env().local_interpretation_timeout_seconds, 9)


class LocalTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_service_turn_cleans_attempt_and_retry_recovers(self):
        case = LOCAL_AI_CASES['id-004']
        attempt = {'localAiCase': case, 'patientProfile': case['patient'],
                   'patientResponses': {}, 'patientMessages': [], 'transcript': [],
                   'askedQuestionIds': [], 'patientRequestActive': False}
        store = SimpleNamespace(lock=threading.RLock(), get=lambda *_args: attempt)
        service = dialogue.PatientDialogueService(store)
        provider = AsyncMock()
        entered = asyncio.Event()
        async def slow(_request):
            entered.set()
            await asyncio.Event().wait()
        provider.complete_chat.side_effect = slow
        req = PatientTurnRequest(attemptId='local-test-attempt-12345', source='typed',
            question='Tell me about those marks after your outdoor weekend.', requestId='cancel-local-request')
        with patch.object(dialogue, 'get_local_llm_provider', return_value=provider), patch.dict('os.environ', {'MEDSIM_SEMANTIC_DIALOGUE_ENABLED':'true'}):
            response = await service.stream(req, None)
            pending = asyncio.create_task(anext(response.body_iterator))
            await entered.wait()
            pending.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await pending
            self.assertFalse(attempt['patientRequestActive'])
            self.assertFalse(attempt['transcript'])
            provider.complete_chat.side_effect = None
            provider.complete_chat.return_value = ChatCompletion(
                '{"status":"answer","fact_ids":["history:rash"],"partial":false}', 'local', 'retry', 0, ('local',))
            response = await service.stream(req, None)
            chunks = [chunk async for chunk in response.body_iterator]
            self.assertIn('Red ring', ''.join(chunks))
            self.assertFalse(attempt['patientRequestActive'])
            self.assertEqual(len(attempt['transcript']), 2)

    async def test_local_interpretation_uses_json_schema_without_cloud_fallback(self):
        captured = []
        def handler(request):
            self.assertEqual(request.url.host, "127.0.0.1")
            captured.append(json.loads(request.content))
            return httpx.Response(200, json={"model": "qwen3-4b-instruct-2507",
                "choices": [{"message": {"content": '{"status":"unknown","fact_ids":[],"partial":false}'}}]})
        provider = OpenAICompatibleLocalProvider(LocalLLMSettings(
            provider="llama_cpp", base_url="http://127.0.0.1:8080/v1",
            patient_model="qwen3-4b-instruct-2507"), httpx.MockTransport(handler))
        result = await provider.complete_chat(ChatRequest("safe facts", [], 200, task="patient-interpretation"))
        self.assertEqual(result.attempted_models, ("qwen3-4b-instruct-2507",))
        self.assertEqual(captured[0]["response_format"]["type"], "json_schema")
        self.assertEqual(captured[0]["max_tokens"], 200)
        self.assertNotIn("Authorization", captured[0])
        await provider.complete_chat(ChatRequest("legacy", [], 80))
        self.assertNotIn("response_format", captured[1])

    async def test_health_rejects_empty_or_wrong_model_catalogue(self):
        settings = LocalLLMSettings(provider="llama_cpp", base_url="http://127.0.0.1:8080/v1", patient_model="expected")
        for ids, expected in (([], "unavailable"), (["other"], "unavailable"), (["expected"], "ready")):
            provider = OpenAICompatibleLocalProvider(settings, httpx.MockTransport(
                lambda request: httpx.Response(200, json={"data": [{"id": id} for id in ids]})))
            with patch('local_llm._detected_gpu',return_value=None):
                self.assertEqual((await provider.health()).state, expected)

    async def test_deadline_includes_gate_wait_and_cancellation_releases_gate(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()
        async def slow(request):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        delegate = AsyncMock()
        delegate.complete_chat.side_effect = slow
        provider = SerializingLocalLLMProvider(delegate)
        first = asyncio.create_task(provider.complete_chat(ChatRequest("first", [], 20)))
        await started.wait()
        with self.assertRaises(TimeoutError):
            await asyncio.wait_for(provider.complete_chat(ChatRequest("queued", [], 20)), .02)
        self.assertEqual(delegate.complete_chat.await_count, 1)
        first.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await first
        self.assertTrue(cancelled.is_set())
        delegate.complete_chat.side_effect = None
        delegate.complete_chat.return_value = ChatCompletion("{}", "local", "retry", 0, ("local",))
        result = await asyncio.wait_for(provider.complete_chat(ChatRequest("retry", [], 20)), .1)
        self.assertEqual(result.request_id, "retry")

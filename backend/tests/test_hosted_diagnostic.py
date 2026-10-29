"""No external networking or inference: real endpoint + scripted provider I/O."""
import asyncio
import gzip
import json
import os
import tempfile
import unittest
from dataclasses import fields, replace
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from hosted_dialogue_diagnostic import (
    CompletionBudget, SSEObservation, Timing, diagnostic_plan, instrument_provider, run_sequence, trial,
)
from local_llm import LocalLLMSettings, OpenRouterLLMProvider, SerializingLocalLLMProvider
from medsim_backend.runtime import create_runtime

MODEL = 'nvidia/nemotron-3.5-super-vl:free'
SENSITIVE = 'private-trace-info-must-never-be-recorded'


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        env = patch.dict(os.environ, {
            'MEDSIM_DATABASE_PATH': str(Path(directory.name) / 'test.db'),
            'MEDSIM_PILOT_MODE': '0', 'MEDSIM_ENVIRONMENT': 'development', 'RENDER': 'false',
            'PATIENT_TTS_PROVIDER': 'disabled', 'PATIENT_TTS_FALLBACK': 'disabled',
            'MEDSIM_SEMANTIC_DIALOGUE_ENABLED': 'true',
        })
        env.start()
        self.addCleanup(env.stop)
        self.runtime = create_runtime()
        self.configured = replace(LocalLLMSettings(), patient_model=MODEL, api_key='scripted-only')

    def provider(self, handler, configured=None, limit=2):
        provider = OpenRouterLLMProvider(configured or self.configured, httpx.MockTransport(handler))
        budget = CompletionBudget(limit=limit)
        instrument_provider(provider, budget)
        return provider, SerializingLocalLLMProvider(provider), budget

    def test_success_measures_queue_preparation_body_validation_and_terminal_separately(self):
        async def handler(request):
            trace = request.extensions['trace']
            await trace('connection.connect_tcp.started', {'request': SENSITIVE})
            await asyncio.sleep(.005)
            await trace('connection.connect_tcp.complete', {'return_value': SENSITIVE})

            class Body(httpx.AsyncByteStream):
                async def __aiter__(self):
                    await asyncio.sleep(.005)
                    yield json.dumps({'model': MODEL, 'choices': [{'message': {
                        'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]}).encode()

            return httpx.Response(200, stream=Body())

        provider, serial, budget = self.provider(handler)
        row = asyncio.run(trial(self.runtime, provider, serial, self.configured, 'scripted', queue_delay=.08))
        self.assertTrue(row['successfulTerminalSSE'])
        self.assertEqual((row['doneEvents'], row['transcriptEntriesAdded'], row['askedQuestionCount']), (1, 2, 0))
        self.assertEqual(budget.used, 1)
        times = row['timings']
        self.assertGreater(times['queueWaitMs'], 5)
        for field in ('localPreparationMs', 'promptMs', 'clientConstructionMs', 'validationMs', 'connection.connect_tcpMs'):
            self.assertGreaterEqual(times[field], 0)
        self.assertLessEqual(times['headersAtMs'], times['firstBodyByteAtMs'])
        self.assertLessEqual(times['providerFinishedAtMs'], times['terminalSSEAtMs'])
        self.assertNotIn(SENSITIVE, json.dumps(row))
        self.assertNotIn('fact_ids', json.dumps(row))

    def test_upstream_200_with_body_timeout_is_failure_without_clinical_evidence(self):
        class StalledBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                await asyncio.sleep(1)
                yield b'not reached'

        configured = replace(self.configured, patient_timeout_seconds=.03, hosted_semantic_timeout_seconds=.2)
        provider, serial, budget = self.provider(lambda _request: httpx.Response(200, stream=StalledBody()), configured)
        row = asyncio.run(trial(self.runtime, provider, serial, configured, 'stalled-body'))
        self.assertEqual((row['httpStatus'], row['timings']['upstreamHTTP']), (200, 200))
        self.assertFalse(row['successfulTerminalSSE'])
        self.assertEqual(row['errorCategories'], ['response-timeout'])
        self.assertEqual((row['doneEvents'], row['transcriptEntriesAdded'], budget.used), (0, 0, 1))
        self.assertNotIn('validationMs', row['timings'])
        self.assertNotIn('firstBodyByteAtMs', row['timings'])

    def test_outer_queue_timeout_does_not_dispatch_or_create_evidence(self):
        configured = replace(self.configured, hosted_semantic_timeout_seconds=.03)
        provider, serial, budget = self.provider(lambda _request: httpx.Response(500), configured)
        row = asyncio.run(trial(self.runtime, provider, serial, configured, 'blocked-queue', queue_delay=1))
        self.assertFalse(row['successfulTerminalSSE'])
        self.assertFalse(row['timings']['queueAcquired'])
        self.assertEqual((row['transcriptEntriesAdded'], budget.used), (0, 0))
        self.assertEqual(row['errorCategories'], ['response-timeout'])
        self.assertFalse(serial._gate.locked())

    def test_completion_budget_is_persisted_before_dispatch_and_cannot_exceed_two(self):
        saved = []
        budget = CompletionBudget(lambda: saved.append(budget.used))
        budget.take()
        budget.take()
        with self.assertRaises(RuntimeError):
            budget.take()
        self.assertEqual(saved, [1, 2])
        self.assertEqual(budget.used, 2)

    def test_third_endpoint_call_is_blocked_before_transport_dispatch(self):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={'model': MODEL, 'choices': [{'message': {
                'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]})

        provider, serial, budget = self.provider(handler)
        rows = [asyncio.run(trial(self.runtime, provider, serial, self.configured, str(i))) for i in range(3)]
        self.assertEqual([row['successfulTerminalSSE'] for row in rows], [True, True, False])
        self.assertEqual((len(calls), budget.used, rows[-1]['transcriptEntriesAdded']), (2, 2, 0))

    def test_experiment_changes_only_isolated_deadlines_and_preserves_default_plan(self):
        baseline, default_labels = diagnostic_plan(self.configured)
        self.assertIs(baseline, self.configured)
        self.assertEqual(default_labels, ('cold', 'warm'))
        isolated, labels = diagnostic_plan(self.configured, True)
        self.assertEqual(labels, ('cold', 'warm-context-1', 'warm-context-2', 'warm-context-3'))
        self.assertEqual((isolated.patient_timeout_seconds, isolated.hosted_semantic_timeout_seconds), (4.8, 5.0))
        self.assertEqual((baseline.patient_timeout_seconds, baseline.hosted_semantic_timeout_seconds), (3.0, 3.2))
        changed = {field.name for field in fields(baseline) if getattr(baseline, field.name) != getattr(isolated, field.name)}
        self.assertEqual(changed, {'patient_timeout_seconds', 'hosted_semantic_timeout_seconds'})
        with self.assertRaises(ValueError):
            diagnostic_plan(replace(baseline, patient_model='nex-agi/nex-n2.5-mini:free'), True)
        for limit in (0, 1, 3, 5, 100):
            with self.assertRaises(ValueError):
                CompletionBudget(limit=limit)

    def test_pooled_plan_requires_unchanged_production_deadlines_and_pinned_model(self):
        configured, labels = diagnostic_plan(self.configured, pooled=True)
        self.assertIs(configured, self.configured)
        self.assertEqual(labels, ('cold', 'pool-eligible'))
        for settings in (replace(configured, patient_timeout_seconds=4.8, hosted_semantic_timeout_seconds=5),
                         replace(configured, patient_model='nex-agi/nex-n2.5-mini:free')):
            with self.assertRaises(ValueError):
                diagnostic_plan(settings, pooled=True)
        with self.assertRaises(ValueError):
            diagnostic_plan(configured, experiment=True, pooled=True)

    def test_real_application_owner_reuses_client_with_request_scoped_measurements_and_closes(self):
        calls, streams = [], [object(), object()]

        async def handler(request):
            calls.append(request)
            trace = request.extensions['trace']
            if len(calls) == 1:
                await trace('connection.connect_tcp.started', {})
                await trace('connection.connect_tcp.complete', {})
            await trace('http11.send_request_headers.started', {})
            await trace('http11.send_request_headers.complete', {})
            return httpx.Response(200, extensions={'network_stream': streams[0]}, json={
                'model': MODEL, 'choices': [{'message': {
                    'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]})

        provider, serial, budget = self.provider(handler)
        self.runtime.app.state.provider_factory = lambda: serial

        async def run():
            with patch('medsim_backend.application.get_tts_manager', return_value=Mock(
                    start_background_preload=Mock(return_value=None))):
                async with self.runtime.app.router.lifespan_context(self.runtime.app):
                    rows = [await trial(self.runtime, provider, serial, self.configured, label,
                                        application_owned=True) for label in ('cold', 'pool-eligible')]
                    client = provider._pooled_client
                    self.assertFalse(client.is_closed)
            self.assertTrue(client.is_closed)
            return rows

        rows = asyncio.run(run())
        self.assertTrue(all(row['successfulTerminalSSE'] for row in rows))
        self.assertEqual((budget.used, len(calls)), (2, 2))
        self.assertEqual([row['connectionId'] for row in rows], [1, 1])
        self.assertEqual([row['newTCPConnectionObserved'] for row in rows], [True, False])
        self.assertEqual([row['timings']['poolClientPresentBeforeRequest'] for row in rows], [False, True])
        self.assertEqual([row['timings']['completionRequestsDispatched'] for row in rows], [1, 1])
        self.assertIn('clientConstructionMs', rows[0]['timings'])
        self.assertNotIn('clientConstructionMs', rows[1]['timings'])
        self.assertIsNot(calls[0].extensions['diagnostic_timing'], calls[1].extensions['diagnostic_timing'])
        self.assertNotEqual(calls[0].headers['x-request-id'], calls[1].headers['x-request-id'])
        self.assertFalse(self.runtime.attempt_store.attempts)
        self.assertIsNone(provider.diagnostic_connection_id(None))
        self.assertEqual(provider.diagnostic_connection_id(streams[1]), 2)

    def test_success_cannot_use_provider_fallback_model_identity_when_upstream_omits_it(self):
        provider, serial, budget = self.provider(lambda _request: httpx.Response(200, json={
            'choices': [{'message': {'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]}))
        row = asyncio.run(trial(self.runtime, provider, serial, self.configured, 'missing-model'))
        self.assertEqual((row['doneEvents'], budget.used), (1, 1))
        self.assertFalse(row['successfulTerminalSSE'])
        self.assertFalse(row['timings']['upstreamModelIdentityConfirmed'])
        self.assertTrue(row['groundedAnswerAndDone'])
        self.assertFalse(row['upstreamModelIdentityConfirmed'])
        self.assertFalse(row['timings']['upstreamModelFieldPresent'])

    def test_failed_cold_body_does_not_count_as_reuse_or_create_clinical_evidence(self):
        calls = []
        streams = [object(), object()]

        class StalledBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b' '
                await asyncio.sleep(1)

        async def handler(request):
            calls.append(request)
            await request.extensions['trace']('connection.connect_tcp.started', {})
            await request.extensions['trace']('connection.connect_tcp.complete', {})
            if len(calls) == 1:
                return httpx.Response(200, stream=StalledBody(), extensions={'network_stream': streams[0]})
            return httpx.Response(200, extensions={'network_stream': streams[1]}, json={
                'model': MODEL, 'choices': [{'message': {
                    'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]})

        configured = replace(self.configured, patient_timeout_seconds=.03, hosted_semantic_timeout_seconds=.2)
        provider, serial, budget = self.provider(handler, configured)
        self.runtime.app.state.provider_factory = lambda: serial

        async def run():
            with patch('medsim_backend.application.get_tts_manager', return_value=Mock(
                    start_background_preload=Mock(return_value=None))):
                async with self.runtime.app.router.lifespan_context(self.runtime.app):
                    return [await trial(self.runtime, provider, serial, configured, label, application_owned=True)
                            for label in ('cold', 'pool-eligible')]

        first, second = asyncio.run(run())
        self.assertFalse(first['successfulTerminalSSE'])
        self.assertEqual(first['errorCategories'], ['response-timeout'])
        self.assertEqual((first['doneEvents'], first['transcriptEntriesAdded']), (0, 0))
        self.assertTrue(second['successfulTerminalSSE'])
        self.assertTrue(second['timings']['poolClientPresentBeforeRequest'])
        self.assertTrue(second['newTCPConnectionObserved'])
        self.assertNotEqual(first['connectionId'], second['connectionId'])
        self.assertEqual((budget.used, len(calls)), (2, 2))

    def test_compressed_response_identity_is_checked_after_httpx_decoding_without_extra_reads(self):
        reads = []

        class CompressedBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                reads.append(True)
                yield gzip.compress(json.dumps({'model': MODEL, 'choices': [{'message': {
                    'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]}).encode())

        provider, serial, budget = self.provider(lambda _request: httpx.Response(
            200, headers={'content-encoding': 'gzip'}, stream=CompressedBody()))
        row = asyncio.run(trial(self.runtime, provider, serial, self.configured, 'compressed'))
        self.assertTrue(row['successfulTerminalSSE'])
        self.assertTrue(row['timings']['upstreamModelIdentityConfirmed'])
        self.assertTrue(row['timings']['encodedResponseBody'])
        self.assertEqual((reads, budget.used), ([True], 1))

    def test_experiment_runs_four_at_4p8_and_blocks_fifth_before_dispatch(self):
        configured, labels = diagnostic_plan(self.configured, True)
        timeouts = []

        def handler(request):
            timeouts.append(request.extensions['timeout']['read'])
            return httpx.Response(200, json={'model': MODEL, 'choices': [{'message': {
                'content': '{"status":"answer","fact_ids":["history:rash"],"partial":false}'}}]})

        provider, serial, budget = self.provider(handler, configured, limit=4)
        rows = [asyncio.run(trial(self.runtime, provider, serial, configured, label)) for label in (*labels, 'blocked-fifth')]
        self.assertEqual([row['successfulTerminalSSE'] for row in rows], [True, True, True, True, False])
        self.assertEqual((timeouts, budget.used), ([4.8] * 4, 4))
        self.assertTrue(all(row['requestDurationMs'] > 0 for row in rows))
        self.assertEqual(rows[-1]['transcriptEntriesAdded'], 0)

    def test_sequence_stops_after_first_quota_rate_or_configuration_failure(self):
        configured, labels = diagnostic_plan(self.configured, True)
        for status in (401, 402, 403, 429):
            with self.subTest(status=status):
                calls = []

                def handler(request):
                    calls.append(request)
                    return httpx.Response(status)

                provider, serial, budget = self.provider(handler, configured, limit=4)
                report = {'rows': []}
                saved = []

                async def invoke(label):
                    return await trial(self.runtime, provider, serial, configured, label)

                asyncio.run(run_sequence(labels, invoke, report, lambda: saved.append(len(report['rows']))))
                self.assertEqual((len(calls), budget.used, len(report['rows']), saved), (1, 1, 1, [1]))
                self.assertTrue(report['stopReason'])
                self.assertFalse(report['rows'][0]['successfulTerminalSSE'])

    def test_sequence_retains_timeout_failures_and_stops_on_redacted_diagnostic_error(self):
        labels = ('cold', 'warm-context-1', 'warm-context-2', 'warm-context-3')
        report = {'rows': []}

        async def invoke(label):
            if label == 'cold':
                return {'label': label, 'successfulTerminalSSE': False, 'errorCategories': ['response-timeout'],
                        'requestDurationMs': 4800}
            raise RuntimeError(SENSITIVE)

        asyncio.run(run_sequence(labels, invoke, report, lambda: None))
        self.assertEqual([row['label'] for row in report['rows']], list(labels[:2]))
        self.assertEqual(report['stopReason'], 'diagnostic-failed')
        self.assertEqual(report['rows'][1]['exceptionType'], 'RuntimeError')
        self.assertGreater(report['rows'][1]['requestDurationMs'], 0)
        self.assertNotIn(SENSITIVE, json.dumps(report))

    def test_embedded_rate_limit_under_http_200_stops_before_a_second_attempt(self):
        configured, labels = diagnostic_plan(self.configured, True)

        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield json.dumps({'error': {'code': 429, 'message': SENSITIVE}}).encode()

        provider, serial, budget = self.provider(lambda _request: httpx.Response(200, stream=Body()), configured, limit=4)
        report = {'rows': []}

        async def invoke(label):
            return await trial(self.runtime, provider, serial, configured, label)

        asyncio.run(run_sequence(labels, invoke, report, lambda: None))
        self.assertEqual((budget.used, len(report['rows'])), (1, 1))
        self.assertEqual(report['rows'][0]['timings']['upstreamHTTP'], 200)
        self.assertEqual(report['stopReason'], 'upstream-http-429')
        self.assertFalse(report['rows'][0]['successfulTerminalSSE'])
        self.assertNotIn(SENSITIVE, json.dumps(report))

    def test_sse_http_200_requires_one_successful_terminal_and_no_truncation_or_error(self):
        for content in (b'data: {"text":"partial"}\n\n',
                        b'data: {"error":"failed","category":"response-timeout"}\n\n',
                        b'data: {"done":true}\n\ndata: {"done":true}\n\n',
                        b'data: {"done":true}\n\ndata: {"text":"late"}\n\n',
                        b'data: {"done":true}\n\ndata: {'):
            observation = SSEObservation(Timing())
            for offset in range(0, len(content), 3):
                observation.feed(content[offset:offset + 3])
            self.assertFalse(observation.successful(200, 'valid-semantic-answer'))
        observation = SSEObservation(Timing())
        observation.feed(b'data: {"done":true}\n\n')
        self.assertFalse(observation.successful(200, None))
        self.assertFalse(observation.successful(200, 'valid-semantic-answer'))
        observation = SSEObservation(Timing())
        observation.feed(b'data: {"text":"validated answer"}\n\ndata: {"done":true}\n\n')
        self.assertTrue(observation.successful(200, 'valid-semantic-answer'))

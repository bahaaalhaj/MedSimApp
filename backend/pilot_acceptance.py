"""Explicit, bounded pilot acceptance; defaults to scripted, zero-network mode.

One lifespan, temporary accounts/database, two sequential turns then two owners
overlapping behind the real inference gate. No health/evaluator/metadata calls.
Use --serve-offline DIST for the isolated browser suite (never for students).
Reports contain status/timing only. Live output must be outside the repository.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import tempfile
import time
import uuid
from contextlib import ExitStack
from contextvars import ContextVar
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from hosted_dialogue_diagnostic import CompletionBudget, SSEObservation, Timing, WAITING_PROBES, instrument_provider, stop_reason


async def acceptance(live, output, serve=None):
    from medsim_backend.config import configure_pilot_dialogue, load_env_local
    load_env_local()
    with tempfile.TemporaryDirectory(prefix='medsim-pilot-acceptance-') as directory, ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {
            'MEDSIM_PILOT_MODE': '1', 'MEDSIM_PILOT_ORIGIN': 'https://pilot-acceptance.example',
            'MEDSIM_DATABASE_PATH': str(Path(directory) / 'acceptance.db'),
            'MEDSIM_COOKIE_SECURE': '1', 'MEDSIM_COOKIE_SAMESITE': 'lax',
            'PATIENT_TTS_PROVIDER': 'disabled', 'PATIENT_TTS_FALLBACK': 'disabled', 'PATIENT_TTS_ENABLED': 'false',
        }))
        if not live:
            stack.enter_context(patch.dict(os.environ, {'OPENROUTER_API_KEY': 'offline-test-not-a-key'}))
        configure_pilot_dialogue()  # Same order as pilot_server: before provider/runtime imports.
        from local_llm import LLMProviderError, LocalLLMSettings, OpenRouterLLMProvider, SerializingLocalLLMProvider
        from medsim_backend.runtime import create_runtime
        from medsim_backend.services import patient_dialogue_service as dialogue
        configured = LocalLLMSettings.from_env()
        if (configured.provider != 'openrouter' or configured.patient_model != 'nvidia/nemotron-3.5-super-vl:free'
                or (configured.patient_timeout_seconds, configured.hosted_semantic_timeout_seconds) != (7.8, 8.0)
                or (live and not configured.api_key)):
            raise RuntimeError('Pilot acceptance configuration is invalid')
        runtime = create_runtime()
        timing_context = ContextVar('pilot_acceptance_timing', default=None)

        class ObservedProvider(OpenRouterLLMProvider):
            @property
            def timing(self):
                return timing_context.get()

            @timing.setter
            def timing(self, value):
                timing_context.set(value)

            async def health(self):
                # Browser grading deliberately takes the deterministic fallback.
                raise LLMProviderError('evaluation-unavailable', 'Scripted acceptance does not call health.', False)

            async def structured_completion(self, *_args):
                raise AssertionError('Evaluator enrichment is forbidden in pilot acceptance')

        async def scripted(request):
            await asyncio.sleep(.04)
            question = json.loads(request.content)['messages'][-1]['content']
            facts = json.loads(json.loads(request.content)['messages'][0]['content'].split('\n')[-1])['facts']
            default = next(row['id'] for row in facts if row['id'].startswith('history:'))
            fact = next((fact for _, prompt, fact, _ in WAITING_PROBES if prompt == question), default)
            return httpx.Response(200, json={'model': configured.patient_model, 'choices': [{'message': {
                'content': json.dumps({'status': 'answer', 'fact_ids': [fact], 'partial': False})}}]})

        report = {'live': live, 'publicHTTPS': False, 'maxCompletions': 4, 'automaticRetries': 0,
                  'patientTimeoutSeconds': configured.patient_timeout_seconds,
                  'semanticTimeoutSeconds': configured.hosted_semantic_timeout_seconds, 'rows': []}
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf8') as handle:
            json.dump(report, handle)

        def persist():
            report['completionRequestsDispatched'] = budget.used
            output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')

        budget = CompletionBudget(persist, limit=4)
        provider = ObservedProvider(configured, None if live else httpx.MockTransport(scripted))
        if not serve:
            instrument_provider(provider, budget)
        serial = SerializingLocalLLMProvider(provider)
        runtime.app.state.provider_factory = lambda: serial
        stop = []
        original_complete = provider.complete_chat

        async def guarded(request):
            if stop:
                raise LLMProviderError('configuration-invalid', 'Acceptance stopped before queued dispatch.', False)
            try:
                return await original_complete(request)
            except LLMProviderError as exc:
                if exc.category in {'configuration-invalid', 'rate-limited', 'free-capacity-unavailable', 'missing-api-key', 'missing-model', 'paid-model-blocked', 'unsupported-parameters', 'reasoning-not-disabled'}:
                    stop.append(exc.category)
                raise
            finally:
                timing = provider.timing
                if timing:
                    status = timing.metrics.get('upstreamErrorCode', timing.metrics.get('upstreamHTTP'))
                    if status in (400, 401, 402, 403, 404, 405, 422, 429):
                        stop.append(f'upstream-http-{status}')

        provider.complete_chat = guarded
        original_serial = serial.complete_chat
        offline_overlap = False
        offline_arrivals = 0
        offline_ready = asyncio.Event()

        async def queued(request):
            nonlocal offline_arrivals
            timing = provider.timing
            if timing:
                timing.mark('queued')
            if offline_overlap:
                # Encounter preparation can exceed the scripted 40 ms response.
                # Rendezvous before the real gate so offline overlap is measured,
                # rather than depending on thread scheduling/preparation speed.
                offline_arrivals += 1
                if offline_arrivals == 2:
                    offline_ready.set()
                await offline_ready.wait()
            try:
                return await original_serial(request)
            finally:
                if timing:
                    timing.mark('providerFinished')

        serial.complete_chat = queued
        original_validate = dialogue.validate_interpretation

        def validate(*args, **kwargs):
            started = time.perf_counter()
            try:
                return original_validate(*args, **kwargs)
            finally:
                if provider.timing:
                    provider.timing.duration('validationMs', started)

        stack.enter_context(patch.object(dialogue, 'validate_interpretation', validate))
        stack.enter_context(patch('medsim_backend.application.get_tts_manager', return_value=Mock(
            start_background_preload=Mock(return_value=None))))
        if not live:
            from semantic_dialogue_smoke import offline_connections
            offline_connections(stack)  # Fail closed on accidental non-loopback networking.
        if serve:
            from medsim_backend.pilot import register_frontend
            import uvicorn

            @runtime.app.get('/api/acceptance/offline')
            async def offline_identity():
                return {'offline': True, 'dialogue': 'scripted', 'evaluation': 'deterministic-only'}

            register_frontend(runtime.app, serve)
            # Same boundary and production assets; all records are disposable.
            await uvicorn.Server(uvicorn.Config(runtime.app, host='127.0.0.1', port=8788,
                proxy_headers=False, access_log=False, log_level='warning')).serve()
            return report

        connections = set()

        async def measured_turn(index):
            timing = Timing()
            timing.expected_model = configured.patient_model
            provider.timing = timing
            observation = SSEObservation(timing)
            case_id, question, fact, terms = WAITING_PROBES[index % 3]

            async def app(scope, receive, send):
                async def observe(message):
                    if scope.get('path') == '/agent/patient/stream' and message['type'] == 'http.response.body':
                        observation.feed(message.get('body', b''))
                        if not message.get('more_body', False):
                            timing.mark('sseComplete')
                    await send(message)
                await runtime.app(scope, receive, observe)

            transport = httpx.ASGITransport(app=app, client=('127.0.0.1', 50000))
            async with httpx.AsyncClient(transport=transport, base_url='https://pilot-acceptance.example',
                    headers={'Origin': 'https://pilot-acceptance.example', 'User-Agent': 'isolated-acceptance'},
                    trust_env=False, timeout=10) as client:
                case = runtime.attempt_service.local_ai_cases[case_id]
                created = await client.post('/api/attempts', json={'caseId': case_id, 'caseVersion': case['caseVersion'],
                    'evidenceVersion': 2, 'dialogueDeliveryVersion': 1})
                created.raise_for_status()
                aid = created.json()['attemptId']
                # Identical IP/UA and different signed anonymous cookies must isolate owners.
                async with httpx.AsyncClient(transport=transport, base_url='https://pilot-acceptance.example',
                        headers={'Origin': 'https://pilot-acceptance.example'}, trust_env=False) as stranger:
                    assert (await stranger.get(f'/api/attempts/{aid}/recovery')).status_code == 404
                rid = str(uuid.uuid4())
                timing.start = time.perf_counter()
                response = await client.post('/agent/patient/stream', json={
                    'attemptId': aid, 'source': 'typed', 'question': question, 'requestId': rid})
                duration = round((time.perf_counter() - timing.start) * 1000, 3)
                attempt = runtime.attempt_store.attempts[aid]
                audit = attempt['patientResponses'].get(rid, {})
                failure = attempt.get('patientFailures', {}).get(rid, {})
                validation = audit.get('validationResult', failure.get('validationResult'))
                grounded = fact in audit.get('matchedFactIds', []) and all(term.lower() in observation.text.lower() for term in terms)
                done = observation.successful(response.status_code, validation)
                acknowledged = False
                if done:
                    receipt = await client.post(f'/api/attempts/{aid}/dialogue/acknowledgements', json={'requestId': rid})
                    acknowledged = receipt.status_code == 200 and receipt.json().get('acknowledged') is True
                connection = provider.diagnostic_connection_id(timing.network_stream)
                new = any(event['event'] == 'connection.connect_tcp.started' for event in timing.events)
                reused = False if new else connection in connections if connection is not None else None
                if connection is not None:
                    connections.add(connection)
                identity = timing.metrics.get('upstreamModelIdentityConfirmed')
                success = done and grounded and acknowledged and identity is True and timing.metrics.get('completionRequestsDispatched') == 1
                row = {'label': ('sequential-' if index < 2 else 'overlap-') + str(index + 1),
                    'httpStatus': response.status_code, 'requestDurationMs': duration,
                    'successfulTerminalSSE': success, 'groundedAnswerAndDone': done and grounded,
                    'doneEvents': observation.done, 'errorCategories': observation.errors,
                    'failureCategory': None if success else observation.errors[0] if observation.errors else 'acceptance-incomplete',
                    'validation': validation, 'acknowledged': acknowledged, 'ownerIsolation': True,
                    'upstreamModelIdentityConfirmed': identity, 'configuredModel': configured.patient_model,
                    'sseModelField': observation.actual_model, 'connectionReused': reused,
                    'connectionId': connection, **timing.report()}
                report['rows'].append(row)
                reason = stop_reason(row)
                if reason:
                    stop.append(reason)
                persist()
                print(json.dumps(row), flush=True)
                return success

        async def turn(index):
            started = time.perf_counter()
            try:
                return await measured_turn(index)
            except (Exception, asyncio.CancelledError) as exc:
                # Retain cancelled/failed acceptance too; never serialize an
                # arbitrary exception message (it could contain request data).
                row = {'label': f'attempt-{index + 1}', 'httpStatus': None,
                       'successfulTerminalSSE': False, 'doneEvents': 0,
                       'requestDurationMs': round((time.perf_counter() - started) * 1000, 3),
                       'errorCategories': ['diagnostic-failed'], 'exceptionType': type(exc).__name__}
                report['rows'].append(row)
                stop.append('diagnostic-failed')
                persist()
                print(json.dumps(row), flush=True)
                return False

        started = time.perf_counter()
        async with runtime.app.router.lifespan_context(runtime.app):
            report['startupDurationMs'] = round((time.perf_counter() - started) * 1000, 3)
            report['startupTLSPreparationMs'] = provider.tls_preparation_ms
            assert budget.used == 0 and provider._pooled_client is None
            first = await turn(0)
            second = await turn(1) if not stop else False
            if first and second and not stop:
                offline_overlap = not live
                await asyncio.gather(turn(2), turn(3))
            else:
                report['overlapSkipped'] = 'Earlier sequential acceptance did not pass'
            pooled = provider._pooled_client
        report['poolClosedOnShutdown'] = pooled is None or pooled.is_closed
        report['stopReasons'] = stop
        report['complete'] = True
        persist()
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--serve-offline', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.live and (args.serve_offline or args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1])):
        parser.error('Live mode requires a private output outside Git and cannot serve a browser')
    for port in (8787, 8788, 4040):
        with socket.socket() as probe:
            probe.settimeout(.2)
            if probe.connect_ex(('127.0.0.1', port)) == 0:
                parser.error('Existing pilot/tunnel listener: coordinate student use first')
    try:
        report = asyncio.run(acceptance(args.live, args.output.resolve(), args.serve_offline))
    except Exception as exc:
        print(json.dumps({'status': 'acceptance-failed', 'exceptionType': type(exc).__name__}))
        return 1
    return 0 if args.serve_offline or len(report['rows']) == 4 and all(row['successfulTerminalSSE'] for row in report['rows']) else 2


if __name__ == '__main__':
    raise SystemExit(main())

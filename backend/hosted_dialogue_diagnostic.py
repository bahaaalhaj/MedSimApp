"""Bounded diagnostic using real routes and the unchanged configured model.

Default mode is scripted/offline. Reports contain timings and status only, never
headers, prompts, answers, raw trace info or exception messages. No public
listener, TTS, retries, evaluator or host database is started/used.
The explicit pooled acceptance mode owns one real application lifespan.
The explicit 4.8/5.0 experiment changes only isolated instance settings and allows
one cold plus three warm-context attempts; the default remains two attempts.
The explicit 7.8/8.0 experiment owns one lifespan and repeats three semantic
questions across three cases, with fresh encounters and request IDs every turn.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import socket
import sys
import tempfile
import time
import uuid
from contextlib import ExitStack, nullcontext
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

MAX_COMPLETIONS = 2
QUESTION = 'Tell me about those marks after your outdoor weekend.'
CASE_ID = 'id-004'
WAITING_PROBES = (
    ('card-003', 'What happens to your breathing when you are horizontal in bed?', 'history:orthopnea', ('pillows',)),
    (CASE_ID, QUESTION, 'history:rash', ('Red ring',)),
    ('im-003', 'Have you been using any pills from home?', 'history:draft-current-medication', ('No regular medicines',)),
)


class CompletionBudget:
    def __init__(self, persist=lambda: None, limit=MAX_COMPLETIONS):
        if limit not in (2, 4, 6):
            raise ValueError('Diagnostic limit must be two, four or six attempts')
        self.limit = limit
        self.used = 0
        self.persist = persist

    def take(self):
        if self.used >= self.limit:
            raise RuntimeError('Diagnostic completion budget exhausted')
        self.used += 1
        self.persist()  # Persist BEFORE dispatch, including failed/cancelled calls.


class Timing:
    def __init__(self):
        self.start = time.perf_counter()
        self.marks = {}
        self.spans = {}
        self.metrics = {}
        self.events = []
        self.network_stream = None

    def mark(self, name):
        self.marks[name] = time.perf_counter()

    def duration(self, name, start):
        self.metrics[name] = round((time.perf_counter() - start) * 1000, 3)

    async def trace(self, name, info):
        # Keep only an opaque stream reference for identity comparison in memory.
        # Never serialize info: it can contain headers, URLs and exceptions.
        if name == 'connection.start_tls.complete':
            self.network_stream = info.get('return_value')
        allowed = {'connection.connect_tcp', 'connection.start_tls',
                   'http11.send_request_headers', 'http11.send_request_body',
                   'http11.receive_response_headers', 'http11.receive_response_body',
                   'http11.response_closed'}
        phase, _, state = name.rpartition('.')
        if phase not in allowed or state not in {'started', 'complete', 'failed'}:
            return
        self.events.append({'event': name, 'atMs': round((time.perf_counter() - self.start) * 1000, 3)})
        if state == 'started':
            self.spans[phase] = time.perf_counter()
        elif phase in self.spans:
            self.metrics[phase + 'Ms'] = round((time.perf_counter() - self.spans[phase]) * 1000, 3)
            self.metrics[phase + 'Outcome'] = state

    def report(self):
        metrics = dict(self.metrics)
        if 'queued' in self.marks:
            end = self.marks.get('delegate', self.marks.get('providerFinished', time.perf_counter()))
            metrics['queueWaitMs'] = round((end - self.marks['queued']) * 1000, 3)
            metrics['queueAcquired'] = 'delegate' in self.marks
        for name in ('headers', 'firstBodyByte', 'firstNonWhitespaceBodyByte', 'providerFinished', 'firstSSE', 'terminalSSE', 'sseComplete'):
            if name in self.marks:
                metrics[name + 'AtMs'] = round((self.marks[name] - self.start) * 1000, 3)
        return {'timings': metrics, 'networkEvents': self.events}


class ObservedBody(httpx.AsyncByteStream):
    def __init__(self, stream, timing):
        self.stream, self.timing = stream, timing

    async def __aiter__(self):
        summary = bytearray()
        bounded = True
        async for chunk in self.stream:
            if chunk and 'firstBodyByte' not in self.timing.marks:
                self.timing.mark('firstBodyByte')
            if chunk.strip() and 'firstNonWhitespaceBodyByte' not in self.timing.marks:
                self.timing.mark('firstNonWhitespaceBodyByte')
            self.timing.metrics['receivedBodyBytes'] = self.timing.metrics.get('receivedBodyBytes', 0) + len(chunk)
            if bounded and len(summary) + len(chunk) <= 8192:
                summary.extend(chunk)
            else:
                bounded = False
                summary.clear()
            yield chunk
        if bounded:
            self.observe_summary(summary)

    def observe_summary(self, summary):
        try:
            payload = json.loads(summary)
            if isinstance(payload, dict):
                self.timing.metrics['upstreamModelFieldPresent'] = isinstance(payload.get('model'), str) and bool(payload['model'])
                self.timing.metrics['upstreamModelIdentityConfirmed'] = (
                    payload.get('model') == getattr(self.timing, 'expected_model', None)
                    and isinstance(payload.get('model'), str))
            error = payload.get('error') if isinstance(payload, dict) else None
            code = error.get('code') if isinstance(error, dict) else None
            if isinstance(code, int) and not isinstance(code, bool) and 400 <= code <= 599:
                # Preserve only the numeric code, never the error message/body.
                self.timing.metrics['upstreamErrorCode'] = code
        except (ValueError, UnicodeError):
            pass

    async def aclose(self):
        await self.stream.aclose()


def instrument_provider(provider, budget):
    original_client = provider._client
    original_complete = provider.complete_chat
    provider.timing = None
    provider.diagnostic_streams = []

    def connection_id(stream):
        if stream is None:
            return None
        for index, known in enumerate(provider.diagnostic_streams, 1):
            if stream is known:
                return index
        provider.diagnostic_streams.append(stream)
        return len(provider.diagnostic_streams)

    provider.diagnostic_connection_id = connection_id

    def client(timeout):
        timing = provider.timing
        started = time.perf_counter()
        result = original_client(timeout)
        timing.duration('clientConstructionMs', started)

        async def outgoing(request):
            timing = provider.timing
            payload = json.loads(request.content)
            if (request.url.path != '/api/v1/chat/completions'
                    or payload.get('model') != provider.settings.patient_model
                    or payload.get('provider', {}).get('allow_fallbacks') is not False
                    or payload.get('provider', {}).get('max_price') != {'prompt': 0, 'completion': 0, 'request': 0}
                    or payload.get('reasoning') != {'effort': 'none'}):
                raise RuntimeError('Unexpected diagnostic request policy')
            budget.take()
            timing.metrics['completionRequestsDispatched'] = timing.metrics.get('completionRequestsDispatched', 0) + 1
            request.extensions['diagnostic_timing'] = timing
            request.extensions['trace'] = timing.trace

        async def incoming(response):
            timing = response.request.extensions['diagnostic_timing']
            timing.response = response
            timing.mark('headers')
            timing.metrics['upstreamHTTP'] = response.status_code
            timing.metrics['encodedResponseBody'] = response.headers.get('content-encoding', 'identity') != 'identity'
            timing.network_stream = response.extensions.get('network_stream', timing.network_stream)
            response.stream = ObservedBody(response.stream, timing)
            if response.is_stream_consumed and len(response.content) <= 8192:
                response.stream.observe_summary(response.content)

        result.event_hooks['request'].append(outgoing)
        result.event_hooks['response'].append(incoming)
        return result

    async def complete(request):
        timing = provider.timing
        timing.mark('delegate')
        started = time.perf_counter()
        try:
            return await original_complete(request)
        finally:
            timing.duration('delegateTotalMs', started)
            response = getattr(timing, 'response', None)
            if response is not None:
                try:
                    # Transport chunks can be compressed. Inspect only HTTPX's
                    # already-read, decoded body; never perform another read.
                    decoded = response.content
                except httpx.ResponseNotRead:
                    pass
                else:
                    if len(decoded) <= 8192:
                        ObservedBody(response.stream, timing).observe_summary(decoded)

    provider._client = client
    provider.complete_chat = complete


class SSEObservation:
    def __init__(self, timing):
        self.timing, self.buffer = timing, b''
        self.done = 0
        self.errors = []
        self.actual_model = None
        self.frames_after_terminal = False
        self.text_bytes = 0
        self.text = ''  # In-memory expected-answer check only; never serialized.

    def feed(self, data):
        self.buffer += data
        while b'\n\n' in self.buffer:
            frame, self.buffer = self.buffer.split(b'\n\n', 1)
            encoded = b'\n'.join(line[5:].lstrip() for line in frame.splitlines() if line.startswith(b'data:'))
            if not encoded:
                continue
            event = json.loads(encoded)
            self.frames_after_terminal |= bool(self.done or self.errors)
            if 'firstSSE' not in self.timing.marks:
                self.timing.mark('firstSSE')
            if isinstance(event.get('text'), str):
                self.text_bytes += len(event['text'].encode())
                self.text += event['text']
            if event.get('error'):
                # Category only, never an upstream error message.
                self.errors.append(event.get('category', 'unknown'))
                self.timing.mark('terminalSSE')
            if event.get('done') is True:
                self.done += 1
                self.actual_model = event.get('actualModel')
                self.timing.mark('terminalSSE')

    def successful(self, http_status, validation):
        return (http_status == 200 and self.done == 1 and self.text_bytes > 0 and not self.errors
                and not self.buffer.strip() and not self.frames_after_terminal
                and validation == 'valid-semantic-answer')


async def trial(runtime, provider, serial, configured, label, *, queue_delay=0, application_owned=False,
                probe=None):
    from medsim_backend.services import patient_dialogue_service as dialogue
    timing = Timing()
    timing.expected_model = configured.patient_model
    observation = SSEObservation(timing)
    case_id, question, expected_fact, expected_terms = probe or (CASE_ID, QUESTION, 'history:rash', ())
    provider.timing = timing
    timing.metrics['poolClientPresentBeforeRequest'] = provider._pooled_client is not None
    if application_owned and (getattr(runtime.app.state, 'llm_provider', None) is not serial
                              or serial._owner_loop is not asyncio.get_running_loop()):
        raise RuntimeError('Diagnostic requires the real application provider owner')
    original_stream = dialogue.PatientDialogueService.stream
    original_prompt = dialogue.interpretation_prompt
    original_validate = dialogue.validate_interpretation
    original_serial = serial.complete_chat
    release = None

    async def stream(service, req, request):
        started = time.perf_counter()
        try:
            return await original_stream(service, req, request)
        finally:
            timing.duration('localPreparationMs', started)

    def measured(name, function):
        def call(*args, **kwargs):
            started = time.perf_counter()
            try:
                return function(*args, **kwargs)
            finally:
                timing.duration(name, started)
        return call

    async def queued(request):
        nonlocal release
        timing.mark('queued')
        if queue_delay:
            release = asyncio.get_running_loop().call_later(queue_delay, serial._gate.release)
        try:
            return await original_serial(request)
        finally:
            timing.mark('providerFinished')

    async def observed_app(scope, receive, send):
        async def observe(message):
            if scope.get('path') == '/agent/patient/stream':
                if message['type'] == 'http.response.body':
                    observation.feed(message.get('body', b''))
                    if not message.get('more_body', False):
                        timing.mark('sseComplete')
            await send(message)
        await runtime.app(scope, receive, observe)

    transport = httpx.ASGITransport(app=observed_app, client=('127.0.0.1', 50000))
    async with httpx.AsyncClient(transport=transport, base_url='http://localhost:8787',
                                 headers={'Origin': 'http://localhost:5173'}, trust_env=False,
                                 timeout=configured.hosted_semantic_timeout_seconds + 2) as client:
        case = runtime.attempt_service.local_ai_cases[case_id]
        created = await client.post('/api/attempts', json={'caseId': case_id, 'caseVersion': case['caseVersion']})
        created.raise_for_status()
        aid = created.json()['attemptId']
        request_id = str(uuid.uuid4())
        if queue_delay:
            await serial._gate.acquire()
        try:
            with patch.object(dialogue.PatientDialogueService, 'stream', stream), \
                    patch.object(dialogue, 'interpretation_prompt', measured('promptMs', original_prompt)), \
                    patch.object(dialogue, 'validate_interpretation', measured('validationMs', original_validate)), \
                    (nullcontext() if application_owned else patch.object(dialogue, 'get_local_llm_provider', return_value=serial)), \
                    patch.object(dialogue, 'llm_settings', return_value=configured), \
                    patch.object(serial, 'complete_chat', queued):
                timing.start = time.perf_counter()
                response = await client.post('/agent/patient/stream', json={'attemptId': aid, 'source': 'typed',
                    'question': question, 'requestId': request_id})
            attempt = runtime.attempt_store.attempts[aid]
            audit = attempt['patientResponses'].get(request_id, {})
            failure = attempt.get('patientFailures', {}).get(request_id, {})
            validation = audit.get('validationResult', failure.get('validationResult'))
            expected_answer = (expected_fact in audit.get('matchedFactIds', [])
                               and all(term.lower() in observation.text.lower() for term in expected_terms))
            success = (observation.successful(response.status_code, validation)
                       and expected_answer
                       and observation.actual_model == configured.patient_model
                       and timing.metrics.get('upstreamModelIdentityConfirmed') is True
                       and timing.metrics.get('completionRequestsDispatched') == 1)
            connection = provider.diagnostic_connection_id(timing.network_stream)
            new_connection = any(event['event'] == 'connection.connect_tcp.started' for event in timing.events)
            if observation.errors:
                category = observation.errors[0]
            elif response.status_code != 200:
                category = f'route-http-{response.status_code}'
            elif not observation.successful(response.status_code, validation):
                category = validation if validation != 'valid-semantic-answer' else 'terminal-sse-invalid'
            elif not expected_answer:
                category = 'unexpected-grounded-answer'
            elif timing.metrics.get('completionRequestsDispatched') != 1:
                category = 'semantic-dispatch-count'
            elif observation.actual_model != configured.patient_model:
                category = 'sse-model-mismatch'
            else:
                category = None if success else 'upstream-model-unconfirmed'
            return {'label': label, 'caseId': case_id, 'httpStatus': response.status_code,
                    'successfulTerminalSSE': success, 'failureCategory': category,
                    'expectedGroundedAnswer': expected_answer,
                    'groundedAnswerAndDone': observation.successful(response.status_code, validation),
                    'upstreamModelIdentityConfirmed': timing.metrics.get('upstreamModelIdentityConfirmed'),
                    'requestDurationMs': round((time.perf_counter() - timing.start) * 1000, 3),
                    'doneEvents': observation.done, 'errorCategories': observation.errors,
                    'actualModel': observation.actual_model, 'validation': validation,
                    'connectionId': connection, 'newTCPConnectionObserved': new_connection,
                    'transcriptEntriesAdded': len(attempt['transcript']) - 1,
                    'askedQuestionCount': len(attempt['askedQuestionIds']), **timing.report()}
        finally:
            runtime.attempt_store.attempts.pop(aid, None)
            if release is not None:
                release.cancel()
                # A pending artificial gate owner must be released on cancellation.
                if 'delegate' not in timing.marks and serial._gate.locked():
                    serial._gate.release()


def diagnostic_plan(configured, experiment=False, pooled=False, waiting=False):
    if waiting:
        if (experiment or pooled or configured.provider != 'openrouter'
                or configured.patient_model != 'nvidia/nemotron-3.5-super-vl:free'
                or (configured.patient_timeout_seconds, configured.hosted_semantic_timeout_seconds) != (3.0, 3.2)):
            raise ValueError('Waiting experiment requires unchanged pinned model and production 3.0/3.2 deadlines')
        isolated = replace(configured, patient_timeout_seconds=7.8, hosted_semantic_timeout_seconds=8.0)
        isolated.validate()
        return isolated, tuple(f'round-{repeat + 1}-question-{question + 1}'
                               for repeat in range(2) for question in range(3))
    if pooled:
        if (experiment or configured.provider != 'openrouter'
                or configured.patient_model != 'nvidia/nemotron-3.5-super-vl:free'
                or (configured.patient_timeout_seconds, configured.hosted_semantic_timeout_seconds) != (3.0, 3.2)):
            raise ValueError('Pooled acceptance requires unchanged pinned model and 3.0/3.2 deadlines')
        return configured, ('cold', 'pool-eligible')
    if not experiment:
        return configured, ('cold', 'warm')
    if configured.provider != 'openrouter' or configured.patient_model != 'nvidia/nemotron-3.5-super-vl:free':
        raise ValueError('Experiment requires the unchanged pinned hosted model')
    isolated = replace(configured, patient_timeout_seconds=4.8, hosted_semantic_timeout_seconds=5.0)
    isolated.validate()
    return isolated, ('cold', 'warm-context-1', 'warm-context-2', 'warm-context-3')


def stop_reason(row):
    if row.get('httpStatus') in (400, 401, 403, 404, 422):
        return f"route-http-{row['httpStatus']}"
    categories = {'rate-limited', 'configuration-invalid', 'free-capacity-unavailable',
                  'missing-api-key', 'missing-model', 'paid-model-blocked',
                  'unsupported-parameters', 'reasoning-not-disabled', 'diagnostic-failed'}
    for category in row['errorCategories']:
        if category in categories:
            return category
    timings = row.get('timings', {})
    status = timings.get('upstreamErrorCode', timings.get('upstreamHTTP'))
    if status in (400, 401, 402, 403, 404, 405, 422, 429):
        return f'upstream-http-{status}'
    return None


async def run_sequence(labels, invoke, report, persist):
    connections = set()
    for label in labels:
        started = time.perf_counter()
        try:
            row = await invoke(label)
        except Exception as exc:
            # Preserve the failed attempt and duration, never arbitrary messages.
            row = {'label': label, 'httpStatus': None, 'successfulTerminalSSE': False,
                   'requestDurationMs': round((time.perf_counter() - started) * 1000, 3),
                   'doneEvents': 0, 'errorCategories': ['diagnostic-failed'],
                   'exceptionType': type(exc).__name__}
        connection = row.get('connectionId')
        row['connectionReused'] = (False if row.get('newTCPConnectionObserved') else
                                   connection in connections if connection is not None else None)
        if connection is not None:
            connections.add(connection)
        report['rows'].append(row)
        reason = stop_reason(row)
        if reason:
            report['stopReason'] = reason
        persist()
        print(json.dumps(row), flush=True)
        if reason:
            break


async def diagnose(live, output, experiment=False, pooled=False, waiting=False):
    from medsim_backend.config import load_env_local
    load_env_local()
    from local_llm import LocalLLMSettings, OpenRouterLLMProvider, SerializingLocalLLMProvider
    production = LocalLLMSettings.from_env()
    configured, labels = diagnostic_plan(production, experiment, pooled, waiting)
    pooled = pooled or waiting
    if configured.provider != 'openrouter' or not configured.patient_model or (live and not configured.api_key):
        raise RuntimeError('Configured hosted provider is required')
    from auth_system import AuthSettings
    database = AuthSettings.from_env().database_path
    protected_paths = [Path(__file__).parent / '.env.local',
                       *(Path(str(database) + suffix) for suffix in ('', '-wal', '-shm', '-journal'))]
    def digest(path):
        with path.open('rb') as handle:
            return hashlib.file_digest(handle, 'sha256').digest()

    protected = {path: digest(path)
                 for path in protected_paths if path.exists()}
    report = {'live': live, 'model': configured.patient_model,
              'patientTimeoutSeconds': configured.patient_timeout_seconds,
              'semanticTimeoutSeconds': configured.hosted_semantic_timeout_seconds,
              'experimentalDeadlines': experiment or waiting,
              'waitingBudgetExperiment': waiting,
              'applicationLifespanOwned': pooled,
              'configuredPatientTimeoutSeconds': production.patient_timeout_seconds,
              'configuredSemanticTimeoutSeconds': production.hosted_semantic_timeout_seconds,
              'maxCompletions': len(labels), 'automaticRetries': 0, 'rows': []}
    # Exclusive creation prevents an accidental repeat under the same report.
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf8') as handle:
        json.dump(report, handle)

    def persist():
        report['completionRequestsDispatched'] = budget.used
        output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')

    budget = CompletionBudget(persist, limit=len(labels))
    with tempfile.TemporaryDirectory(prefix='medsim-dialogue-diagnostic-') as directory, ExitStack() as stack:
        stack.enter_context(patch.dict(os.environ, {
            'MEDSIM_DATABASE_PATH': str(Path(directory) / 'diagnostic.db'), 'MEDSIM_PILOT_MODE': '0',
            'MEDSIM_ENVIRONMENT': 'development', 'RENDER': 'false', 'MEDSIM_COOKIE_SECURE': '0',
            'MEDSIM_COOKIE_SAMESITE': 'lax', 'PATIENT_TTS_PROVIDER': 'disabled',
            'PATIENT_TTS_FALLBACK': 'disabled', 'PATIENT_TTS_ENABLED': 'false',
        }))
        if not live:
            from semantic_dialogue_smoke import offline_connections
            offline_connections(stack)
        from medsim_backend.runtime import runtime

        class ScriptedBody(httpx.AsyncByteStream):
            def __init__(self, fact):
                self.fact = fact

            async def __aiter__(self):
                await asyncio.sleep(.02)
                yield json.dumps({'model': configured.patient_model, 'choices': [{'message': {
                    'content': json.dumps({'status': 'answer', 'fact_ids': [self.fact], 'partial': False})}}]}).encode()

        async def scripted(request):
            await asyncio.sleep(.02)
            question = json.loads(request.content)['messages'][-1]['content']
            fact = next((fact for _, prompt, fact, _ in WAITING_PROBES if prompt == question), 'history:rash')
            return httpx.Response(200, stream=ScriptedBody(fact))

        provider = OpenRouterLLMProvider(configured, None if live else httpx.MockTransport(scripted))
        instrument_provider(provider, budget)
        serial = SerializingLocalLLMProvider(provider)
        async def invoke(label):
            probe = WAITING_PROBES[labels.index(label) % 3] if waiting else None
            report['semanticAttemptsStarted'] = report.get('semanticAttemptsStarted', 0) + 1
            persist()
            return await trial(runtime, provider, serial, configured, label,
                               queue_delay=.05 if not live and label != 'cold' else 0,
                               application_owned=pooled, probe=probe)

        if pooled:
            runtime.app.state.provider_factory = lambda: serial
            # Exercise the actual app/provider lifecycle without starting audio.
            with patch('medsim_backend.application.get_tts_manager', return_value=Mock(
                    start_background_preload=Mock(return_value=None))), ExitStack() as startup_guard:
                report['startupOutboundAttempts'] = 0

                def no_startup_network(*_args, **_kwargs):
                    report['startupOutboundAttempts'] += 1
                    raise RuntimeError('Diagnostic startup must not make network requests')

                for target, name in ((socket, 'getaddrinfo'), (socket.socket, 'connect'), (socket.socket, 'connect_ex')):
                    startup_guard.enter_context(patch.object(target, name, no_startup_network))
                started = time.perf_counter()
                try:
                    async with runtime.app.router.lifespan_context(runtime.app):
                        if (report['startupOutboundAttempts'] or budget.used or provider._pooled_client is not None
                                or (live and provider._ssl_context is None)):
                            raise RuntimeError('Hosted startup preparation did not preserve diagnostic isolation')
                        report['startupDurationMs'] = round((time.perf_counter() - started) * 1000, 3)
                        report['startupTLSPreparationMs'] = provider.tls_preparation_ms
                        report['verifiedContextPreparedBeforeFirstTurn'] = provider._ssl_context is not None
                        report['completionRequestsAtStartup'] = budget.used
                        persist()
                        startup_guard.close()  # Only the explicitly bounded turns may now connect.
                        await run_sequence(labels, invoke, report, persist)
                        pooled_client = provider._pooled_client
                except Exception as exc:
                    if 'startupDurationMs' not in report:
                        report['startupFailure'] = {'exceptionType': type(exc).__name__,
                            'category': getattr(exc, 'category', 'diagnostic-failed'),
                            'durationMs': round((time.perf_counter() - started) * 1000, 3)}
                        persist()
                    raise
            report['poolClosedOnShutdown'] = pooled_client is None or pooled_client.is_closed
        else:
            await run_sequence(labels, invoke, report, persist)
        if pooled and len(report['rows']) == 2:
            first, second = report['rows']
            if second.get('newTCPConnectionObserved'):
                report['secondConnectionReused'] = False
            elif first.get('connectionId') is not None and second.get('connectionId') is not None:
                report['secondConnectionReused'] = first['connectionId'] == second['connectionId']
            else:
                report['secondConnectionReused'] = None  # Eligibility alone is not transport evidence.
    if (set(path for path in protected_paths if path.exists()) != set(protected)
            or any(digest(path) != original_digest for path, original_digest in protected.items())):
        raise RuntimeError('Protected configuration/database changed')
    report['protectedFilesUnchanged'] = True
    report['complete'] = True
    persist()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--experiment-4p8-5p0', action='store_true',
                        help='Isolated 4.8/5.0-second experiment: one cold and three warm-context attempts, maximum four')
    mode.add_argument('--pooled-acceptance', action='store_true',
                      help='Two semantic attempts in one application lifespan, unchanged 3.0/3.2 deadlines')
    mode.add_argument('--experiment-7p8-8p0', action='store_true',
                      help='Isolated lifespan: three semantic questions twice, maximum six attempts, no retries')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('output must be outside the repository')
    if args.live:
        for port in (8787, 8788):
            with socket.socket() as probe:
                probe.settimeout(.2)
                if probe.connect_ex(('127.0.0.1', port)) == 0:
                    parser.error('Existing MedSim listener: coordinate student use before a separate live diagnostic')
    try:
        report = asyncio.run(diagnose(args.live, args.output.resolve(), args.experiment_4p8_5p0,
                                      args.pooled_acceptance, args.experiment_7p8_8p0))
    except Exception as exc:
        # Never echo arbitrary HTTP exceptions, request/response objects or values.
        print(json.dumps({'status': 'diagnostic-failed', 'exceptionType': type(exc).__name__}))
        return 1
    return 0 if report['rows'] and all(row['successfulTerminalSSE'] for row in report['rows']) else 2


if __name__ == '__main__':
    sys.exit(main())

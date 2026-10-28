"""Bounded, body-free terminal diagnostics. Never format exception messages."""
from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import traceback
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path

from starlette.types import ASGIApp, Receive, Scope, Send


_request_id: ContextVar[str | None] = ContextVar('medsim_diagnostic_request', default=None)
_logger = logging.getLogger('medsim.diagnostics')
_categories = frozenset({
    'rate-limited', 'response-timeout', 'configuration-invalid', 'missing-api-key', 'missing-model',
    'paid-model-blocked', 'free-capacity-unavailable', 'model-unavailable', 'local-provider-disabled',
    'model-starting', 'low-memory', 'invalid-request', 'request-in-progress', 'reasoning-not-disabled',
    'unsupported-parameters', 'health-invalid-response', 'evaluation-timeout', 'evaluation-unavailable',
    'invalid-evaluator-schema', 'ungrounded-evaluator-evidence', 'tts-configuration-invalid',
    'tts-provider-failed', 'tts-model-missing', 'tts-model-invalid', 'tts-initialization-failed',
    'tts-preparation-failed', 'tts-cache-write-failed', 'tts-fallback', 'application-error',
    'http-error', 'client-disconnected',
})
_validations = frozenset({
    'deterministic', 'semantic-provider-failed', 'provider-failed', 'invalid-semantic-size',
    'invalid-semantic-json', 'invalid-semantic-schema', 'invalid-semantic-ids',
    'invalid-semantic-status', 'invalid-semantic-fact', 'invalid-semantic-grounding',
    'empty-semantic-answer', 'semantic-case-mismatch', 'unauthorized-semantic-fact',
    'unsafe-semantic-source', 'semantic-reply-budget',
    'valid-semantic-answer', 'valid-semantic-unknown', 'valid-semantic-clarify',
})


def configure_terminal_logging() -> None:
    """Configure our logger only; leave Uvicorn, root, HTTPX and evidence alone."""
    if not _logger.handlers:
        handler = logging.StreamHandler()  # stderr, the terminal running the backend
        handler.setFormatter(logging.Formatter('%(message)s'))
        _logger.addHandler(handler)
    _logger.setLevel(logging.INFO)
    _logger.propagate = False


def _safe_id(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError):
        # Non-UUID API IDs remain valid, but may contain arbitrary user input.
        return 'sha256:' + hashlib.sha256(value.encode('utf-8', errors='replace')).hexdigest()[:16]


def log_event(event: str, *, level: int = logging.WARNING, request_id: str | None = None,
              category: str | None = None, error: BaseException | None = None,
              status: int | None = None, retryable: bool | None = None,
              latency_ms: float | None = None, validation: str | None = None,
              scope: Scope | None = None, http_status: int | None = None) -> None:
    """Only explicit operational fields; no bodies, cookies, URLs or raw errors."""
    record: dict[str, object] = {
        'time': datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
        'level': logging.getLevelName(level), 'event': event,
    }
    if _request_id.get():
        record['serverRequestId'] = _request_id.get()
    if request_id:
        record['requestId'] = _safe_id(request_id)
    if category:
        record['category'] = category if category in _categories else 'unclassified'
    if status is not None:
        record['upstreamStatus'] = status
    if http_status is not None:
        record['httpStatus'] = http_status
    if retryable is not None:
        record['retryable'] = retryable
    if latency_ms is not None:
        record['durationMs'] = round(latency_ms, 3)
    if validation:
        record['validation'] = validation if validation in _validations else 'unclassified'
    if scope is not None:
        # A route template, NOT request.url (query strings / IDs can be secrets).
        record['route'] = getattr(scope.get('route'), 'path', '<unmatched>')
        method = scope.get('method', '')
        record['method'] = method if method in {'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'} else 'OTHER'
    if error is not None:
        # ExceptionGroup messages and traceback source lines may contain secrets.
        while isinstance(error, BaseExceptionGroup) and error.exceptions:
            error = error.exceptions[0]
        record['exceptionType'] = re.sub(r'[^A-Za-z0-9_]', '_', type(error).__name__)[:80]
        record['stack'] = [f'{Path(frame.filename).name}:{frame.lineno}:{frame.name}'
                           for frame in traceback.extract_tb(error.__traceback__)[-8:]]
    try:
        _logger.log(level, json.dumps(record, ensure_ascii=True, separators=(',', ':')))
    except Exception:
        # A closed/broken terminal must not replace the application's response.
        pass


def background_exception_handler(_loop, context) -> None:
    # asyncio's default handler prints context/exception text, potentially secrets.
    log_event('background-task-failed', level=logging.ERROR, category='application-error',
              error=context.get('exception'))


class DiagnosticMiddleware:
    """Observe failures including streaming exceptions, without buffering bodies."""
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return
        token = _request_id.set(str(uuid.uuid4()))
        started = time.perf_counter()
        status = None

        async def observe(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
                message['headers'] = [(key, value) for key, value in message.get('headers', []) if key.lower() != b'x-medsim-request-id']
                message['headers'].append((b'x-medsim-request-id', _request_id.get().encode('ascii')))
            await send(message)

        try:
            await self.app(scope, receive, observe)
        except Exception as exc:
            log_event('http-request-failed', level=logging.ERROR, category='application-error',
                      error=exc, scope=scope, http_status=status,
                      latency_ms=(time.perf_counter() - started) * 1000)
            raise  # Keep existing exception handling, HTTP responses and SSE semantics.
        else:
            if status is not None and status >= 400:
                log_event('http-request-rejected', level=logging.ERROR if status >= 500 else logging.WARNING,
                          category='http-error', scope=scope, http_status=status,
                          latency_ms=(time.perf_counter() - started) * 1000)
            elif scope.get('path', '').startswith(('/api/attempts', '/api/local-ai/evaluate', '/tts/synthesize')):
                headers = dict(scope.get('headers', []))
                log_event('http-request-completed', level=logging.INFO, scope=scope, http_status=status,
                          request_id=headers.get(b'x-request-id', b'').decode('ascii', errors='ignore') or None,
                          latency_ms=(time.perf_counter() - started) * 1000)
        finally:
            _request_id.reset(token)

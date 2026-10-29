"""Explicitly opt-in six-GET connection study. Never sends a completion.

Only phase durations, counts, status codes and exception types are retained.
The report must be new and outside the repository. No application is started.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import socket
import ssl
import time
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import httpx

from hosted_dialogue_diagnostic import Timing


ENDPOINT = 'https://openrouter.ai/api/v1/models/count'
ORDER = ('fresh', 'shared', 'fresh', 'shared', 'fresh', 'shared')


async def study(configured, output):
    parsed = urlparse(configured.base_url)
    if (configured.provider != 'openrouter' or parsed.scheme != 'https'
            or parsed.netloc != 'openrouter.ai' or parsed.path != '/api/v1'
            or parsed.query or parsed.fragment):
        raise ValueError('Study requires the configured canonical OpenRouter HTTPS host')
    report = {'endpoint': ENDPOINT, 'method': 'GET', 'maximumRequests': 6,
              'requestsReserved': 0, 'completionRequests': 0, 'retries': 0,
              'spacingAfterResponseSeconds': 2, 'requestDeadlineSeconds': 10,
              'keepaliveExpirySeconds': 30, 'rows': []}
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as target:
        json.dump(report, target)

    def persist():
        output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    started = time.perf_counter()
    verified = httpx.create_ssl_context()
    assert verified.check_hostname and verified.verify_mode == ssl.CERT_REQUIRED
    report['verifiedContextConstructionMs'] = round((time.perf_counter()-started)*1000, 3)
    report['certificateVerification'] = True
    current = None
    original_resolve = socket.getaddrinfo

    def resolve(*args, **kwargs):
        # Observe the normal resolver call; do not resolve a second time or
        # substitute addresses. Calls can execute in the loop's worker thread.
        timing = current
        before = time.perf_counter()
        try:
            return original_resolve(*args, **kwargs)
        finally:
            if timing is not None:
                timing.metrics['resolverMs'] = round((time.perf_counter()-before)*1000, 3)

    def client():
        # HTTPX's transport defaults to zero retries; redirects are disabled.
        return httpx.AsyncClient(verify=verified, timeout=10, follow_redirects=False,
                                 limits=httpx.Limits(max_connections=1, max_keepalive_connections=1,
                                                    keepalive_expiry=30))

    shared = client()
    try:
        with patch.object(socket, 'getaddrinfo', resolve):
            for index, mode in enumerate(ORDER):
                timing = Timing()
                current = timing
                row = {'sequence': index+1, 'client': mode}
                construction = time.perf_counter()
                selected = client() if mode == 'fresh' else shared
                row['clientConstructionMs'] = round((time.perf_counter()-construction)*1000, 3)
                report['requestsReserved'] += 1
                persist()  # Count before dispatch; failed requests count too.
                before = time.perf_counter()
                try:
                    async with asyncio.timeout(10):
                        async with selected.stream('GET', ENDPOINT,
                                headers={'Authorization': 'Bearer ' + configured.api_key},
                                extensions={'trace': timing.trace}) as response:
                            timing.mark('headers')
                            row['httpStatus'] = response.status_code
                            data = await response.aread()
                            row['bodyBytes'] = len(data)
                            row['countSchemaValid'] = False
                            if response.status_code == 200:
                                payload = json.loads(data)
                                item = payload.get('data') if isinstance(payload, dict) else None
                                row['countSchemaValid'] = isinstance(item, dict) and type(item.get('count')) is int
                except (httpx.HTTPError, TimeoutError, ValueError) as error:
                    row['exceptionType'] = type(error).__name__
                finally:
                    row['totalMs'] = round((time.perf_counter()-before)*1000, 3)
                    row.update(timing.report())
                    row['newTCPConnectionObserved'] = any(
                        event['event'] == 'connection.connect_tcp.started' for event in timing.events)
                    report['rows'].append(row)
                    persist()
                    print(json.dumps(row), flush=True)
                    if mode == 'fresh':
                        await selected.aclose()
                    current = None
                if row.get('httpStatus') in {401, 402, 403, 429}:
                    report['stoppedEarly'] = True
                    break
                if index < len(ORDER)-1:
                    await asyncio.sleep(2)
    finally:
        await shared.aclose()
        persist()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live-get-study', action='store_true', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('Report must be outside the repository')
    from medsim_backend.config import load_env_local
    load_env_local()
    from local_llm import LocalLLMSettings
    asyncio.run(study(LocalLLMSettings.from_env(), args.output))

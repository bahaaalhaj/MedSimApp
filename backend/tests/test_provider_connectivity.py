"""The six-request diagnostic is tested with in-memory HTTP only."""
import asyncio
import io
import json
import ssl
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_llm import LocalLLMSettings
from provider_connectivity import ENDPOINT, ORDER, study


class ConnectivityStudyTests(unittest.TestCase):
    def test_six_get_cap_spacing_redaction_and_client_ownership(self):
        clients, requests = [], []
        original = httpx.AsyncClient
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={'data': {'count': 100}})
        def client(**kwargs):
            result = original(transport=httpx.MockTransport(handler), **kwargs)
            clients.append(result)
            return result
        configured = LocalLLMSettings(api_key='private-fixture-credential')
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), \
                patch('provider_connectivity.httpx.create_ssl_context', return_value=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)), \
                patch('provider_connectivity.httpx.AsyncClient', side_effect=client), \
                patch('provider_connectivity.asyncio.sleep', new_callable=AsyncMock) as sleep:
            report = asyncio.run(study(configured, Path(directory)/'report.json'))
        self.assertEqual(report['requestsReserved'], 6)
        self.assertEqual(report['completionRequests'], 0)
        self.assertEqual(report['retries'], 0)
        self.assertEqual(tuple(row['client'] for row in report['rows']), ORDER)
        self.assertEqual(len(clients), 4)
        self.assertTrue(all(client.is_closed for client in clients))
        self.assertEqual(sleep.await_count, 5)
        self.assertTrue(all(request.method == 'GET' and str(request.url) == ENDPOINT for request in requests))
        self.assertNotIn(configured.api_key, json.dumps(report))

    def test_auth_failure_stops_early_and_existing_report_cannot_be_reused(self):
        original = httpx.AsyncClient
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(403)
        def client(**kwargs):
            return original(transport=httpx.MockTransport(handler), **kwargs)
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), \
                patch('provider_connectivity.httpx.create_ssl_context', return_value=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)), \
                patch('provider_connectivity.httpx.AsyncClient', side_effect=client):
            path = Path(directory)/'report.json'
            report = asyncio.run(study(LocalLLMSettings(), path))
            self.assertTrue(report['stoppedEarly'])
            self.assertEqual(report['requestsReserved'], 1)
            with self.assertRaises(FileExistsError):
                asyncio.run(study(LocalLLMSettings(), path))
        self.assertEqual(len(requests), 1)

    def test_noncanonical_host_or_endpoint_is_rejected_before_network_or_report_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'report.json'
            for base in ('http://openrouter.ai/api/v1', 'https://elsewhere.invalid/api/v1',
                         'https://openrouter.ai/api/v1/chat/completions', 'https://user@openrouter.ai/api/v1'):
                with self.assertRaises(ValueError):
                    asyncio.run(study(replace(LocalLLMSettings(), base_url=base), path))
            self.assertFalse(path.exists())

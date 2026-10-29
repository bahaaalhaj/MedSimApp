"""Scripted transport/endpoint regressions, not real hosted-model results."""
import asyncio
import json
import math
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, patch, sentinel

import httpx
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from test_support import TestClient
from local_llm import ChatCompletion, ChatRequest, LLMProviderError, LocalLLMSettings, OpenRouterLLMProvider
from medsim_backend.services import patient_dialogue_service as dialogue
from hosted_deadline_benchmark import percentile95, summarize


class HostedDeadlineTests(unittest.TestCase):
    def test_nearest_rank_p95_and_empty_groups_are_reported_honestly(self):
        self.assertEqual(percentile95([4,1,3,2]),4)
        self.assertIsNone(percentile95([]))
        self.assertTrue(all(g['successRate'] is None for g in summarize([])))

    def test_comparison_counts_errors_without_dropping_timed_out_samples(self):
        rows=[{'totalDeadlineSeconds':3.2,'latencyMs':v,'success':ok,'category':category}
              for v,ok,category in [(2,True,'success'),(3,False,'response-timeout')]]
        summary=summarize(rows)[0]
        self.assertEqual(summary['successRate'],.5)
        self.assertEqual(summary['medianMs'],2.5)
        self.assertEqual(summary['successfulMedianMs'],2)
        self.assertEqual(summary['p95Ms'],3)

    def test_matched_experimental_budgets_and_finite_limits(self):
        for total, inner in ((3.2,3),(5,4.8),(8,7.8)):
            settings=replace(LocalLLMSettings(),hosted_semantic_timeout_seconds=total,patient_timeout_seconds=inner)
            settings.validate()
            with patch.object(dialogue,'llm_settings',return_value=settings):
                self.assertEqual(dialogue.semantic_timeout_seconds(),total)
        for total,inner in ((math.nan,3),(math.inf,3),(8.1,3),(5,5),(3.2,4.8)):
            with self.subTest(total=total,inner=inner),self.assertRaises(ValueError):
                replace(LocalLLMSettings(),hosted_semantic_timeout_seconds=total,patient_timeout_seconds=inner).validate()

    def test_transport_does_not_silently_clamp_longer_experiment_to_three_seconds(self):
        timeouts=[]
        def handler(request):
            timeouts.append(request.extensions['timeout']['read'])
            return httpx.Response(200,json={'model':'nvidia/nemotron-3.5-super-vl:free',
                'choices':[{'message':{'content':'{"status":"unknown","fact_ids":[],"partial":false}'}}]})
        configured=replace(LocalLLMSettings(),patient_model='nvidia/nemotron-3.5-super-vl:free',api_key='test-key',hosted_semantic_timeout_seconds=5,patient_timeout_seconds=4.8)
        asyncio.run(OpenRouterLLMProvider(configured,httpx.MockTransport(handler)).complete_chat(
            ChatRequest('facts',[],200,task='patient-interpretation')))
        self.assertEqual(timeouts,[4.8])


class HostedTLSContextTests(unittest.TestCase):
    def test_verified_context_is_lazy_and_reused_without_reusing_async_clients(self):
        with patch('local_llm.httpx.create_ssl_context',return_value=sentinel.verified_context) as context, patch('local_llm.httpx.AsyncClient') as client:
            provider=OpenRouterLLMProvider(LocalLLMSettings())
            context.assert_not_called()
            provider._client(3)
            provider._client(7)
            context.assert_called_once_with()
            self.assertEqual(client.call_count,2)
            self.assertEqual([call.kwargs['timeout'] for call in client.call_args_list],[3,7])
            self.assertTrue(all(call.kwargs['verify'] is sentinel.verified_context for call in client.call_args_list))

    def test_certificate_environment_change_rebuilds_the_verified_context(self):
        with patch('local_llm.httpx.create_ssl_context',side_effect=[sentinel.first,sentinel.second]) as context, patch('local_llm.httpx.AsyncClient') as client:
            provider=OpenRouterLLMProvider(LocalLLMSettings())
            with patch.dict('os.environ',{'SSL_CERT_FILE':'first-test-ca.pem'}):
                provider._client(3)
                provider._client(3)
            with patch.dict('os.environ',{'SSL_CERT_FILE':'second-test-ca.pem'}):
                provider._client(3)
            self.assertEqual(context.call_count,2)
            self.assertEqual([call.kwargs['verify'] for call in client.call_args_list],[sentinel.first,sentinel.first,sentinel.second])

    def test_injected_transports_preserve_the_existing_test_and_diagnostic_path(self):
        transport=httpx.MockTransport(lambda request:httpx.Response(200))
        with patch('local_llm.httpx.create_ssl_context') as context, patch('local_llm.httpx.AsyncClient') as client:
            provider=OpenRouterLLMProvider(LocalLLMSettings(),transport)
            provider._client(3)
            context.assert_not_called()
            client.assert_called_once_with(timeout=3,transport=transport)

    def test_real_default_context_requires_certificates_and_hostname_verification(self):
        import ssl
        with patch('local_llm.httpx.AsyncClient') as client:
            OpenRouterLLMProvider(LocalLLMSettings())._client(3)
        context=client.call_args.kwargs['verify']
        self.assertEqual(context.verify_mode,ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)


class RetryablePatientFailureTests(unittest.TestCase):
    def setUp(self):
        server.limiter.reset()
        self.addCleanup(server.limiter.reset)
        self.client=TestClient(server.app,headers={'Origin':'http://localhost:5173'})
        self.case=server.LOCAL_AI_CASES['id-004']
        created=self.client.post('/api/attempts',json={'caseId':'id-004','caseVersion':self.case['caseVersion'],'variantSeed':'retry-test'})
        self.aid=created.json()['attemptId']
        self.attempt=server._INVESTIGATION_ATTEMPTS[self.aid]
        self.addCleanup(server._INVESTIGATION_ATTEMPTS.pop,self.aid,None)
        self.flag=patch.dict('os.environ',{'MEDSIM_SEMANTIC_DIALOGUE_ENABLED':'true'})
        self.flag.start()
        self.addCleanup(self.flag.stop)

    def turn(self,provider,request_id='retry-stable-request',question='Tell me about those marks after your outdoor weekend.'):
        with patch.object(dialogue,'get_local_llm_provider',return_value=provider):
            response=self.client.post('/agent/patient/stream',json={'attemptId':self.aid,'source':'typed','question':question,'requestId':request_id})
        self.assertEqual(response.status_code,200)
        return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]

    def test_provider_failure_is_not_a_patient_turn_and_same_id_retry_commits_once(self):
        provider=AsyncMock()
        provider.complete_chat.side_effect=LLMProviderError('response-timeout','timeout',True)
        before=list(self.attempt['transcript'])
        frames=self.turn(provider)
        self.assertEqual(frames[-1]['category'],'response-timeout')
        self.assertTrue(frames[-1]['retryable'])
        self.assertFalse(any('text' in frame for frame in frames))
        self.assertEqual(self.attempt['transcript'],before)
        self.assertFalse(self.attempt['patientResponses'])
        self.assertFalse(self.attempt['askedQuestionIds'])
        self.assertFalse(self.attempt['patientRequestActive'])
        provider.complete_chat.side_effect=None
        provider.complete_chat.return_value=ChatCompletion('{"status":"answer","fact_ids":["history:rash"],"partial":false}','fixture','retry-stable-request',0,('fixture',))
        self.turn(provider)
        self.turn(provider)
        self.assertEqual(provider.complete_chat.await_count,2)  # failure, success; replay is cached
        self.assertEqual(len(self.attempt['transcript']),len(before)+2)
        self.assertEqual(len(self.attempt['patientResponses']),1)
        self.assertFalse(self.attempt['askedQuestionIds'])

    def test_valid_unknown_is_clinical_uncertainty_not_a_provider_failure(self):
        provider=AsyncMock()
        provider.complete_chat.return_value=ChatCompletion('{"status":"unknown","fact_ids":[],"partial":false}','fixture','unknown',0,('fixture',))
        frames=self.turn(provider)
        self.assertFalse(any('error' in frame for frame in frames))
        self.assertEqual(frames[-1]['provenance'],'safe-unknown')
        self.assertEqual(len(self.attempt['transcript']),3)

    def test_bad_model_selection_and_rate_limits_never_create_clinical_absence(self):
        for index,result in enumerate(('invalid JSON','{"status":"answer","fact_ids":["protected:rubric"],"partial":false}',LLMProviderError('rate-limited','rate',True))):
            provider=AsyncMock()
            if isinstance(result,Exception):
                provider.complete_chat.side_effect=result
            else:
                provider.complete_chat.return_value=ChatCompletion(result,'fixture','bad',0,('fixture',))
            frames=self.turn(provider,request_id=f'failure-request-{index}')
            self.assertIn('error',frames[-1])
            self.assertEqual(len(self.attempt['transcript']),1)
            self.assertFalse(self.attempt['askedQuestionIds'])

    def test_partial_authored_data_does_not_turn_transport_failure_into_missing_history(self):
        provider=AsyncMock()
        provider.complete_chat.side_effect=TimeoutError()
        frames=self.turn(provider,question='Do you have drug allergies or food allergies?')
        self.assertEqual(frames[-1]['category'],'response-timeout')
        self.assertFalse(any('text' in frame for frame in frames))
        self.assertEqual(len(self.attempt['transcript']),1)

"""Actual manifest roles and interrupted delivery; temporary records, no inference."""
import asyncio
import copy
import os
import unittest
from dataclasses import replace
from unittest.mock import AsyncMock, patch

import httpx

import test_pilot as fixtures
from local_llm import LocalLLMSettings
from medsim_backend.config import configure_pilot_dialogue


class PilotPreparationTests(unittest.TestCase):
    setUp = fixtures.PilotTests.setUp
    client = fixtures.PilotTests.client

    def create(self, case_id=None, delivery=None):
        case = self.runtime.investigation_cases[case_id or self.case['caseId']]
        response = self.one.post('/api/attempts', json={
            'caseId': case['caseId'], 'caseVersion': case['caseVersion'], 'evidenceVersion': 2,
            **({'dialogueDeliveryVersion': delivery} if delivery else {}),
        })
        self.assertEqual(response.status_code, 201)
        return self.runtime.attempt_store.attempts[response.json()['attemptId']]

    def evaluate(self, attempt):
        provider = AsyncMock()
        provider.health.side_effect = RuntimeError('offline scripted evaluator')
        with patch('medsim_backend.services.evaluation_service.get_local_llm_provider', return_value=provider):
            response = self.one.post('/api/local-ai/evaluate', json={
                'attemptId': attempt['attemptId'], 'caseId': attempt['caseId'], 'caseVersion': attempt['caseVersion'],
            })
        return response, provider

    def order(self, attempt, definition, release=False):
        aid = attempt['attemptId']
        response = self.one.post(f'/api/attempts/{aid}/investigations/orders', json={
            'investigationId': definition['testId'], 'indication': 'Synthetic regression indication',
        })
        self.assertEqual(response.status_code, 201)
        order = attempt['orders'][response.json()['orderId']]
        if release:
            order['availableAt'] = 0
            self.assertEqual(self.one.get(f"/api/attempts/{aid}/investigations/{order['orderId']}").status_code, 200)

    def test_real_manifest_harmful_orders_apply_existing_credit_rule_and_feedback_without_changing_maxima(self):
        catalogue = next(case for case in self.runtime.investigation_cases.values()
                         if any(row['role'] == 'potentially-harmful' for row in case['investigations']))
        before_manifest = copy.deepcopy(catalogue)
        outcomes = {}
        for extra in (None, 'useful', 'optional', 'conditional', 'not-indicated', 'potentially-harmful'):
            with self.subTest(extra=extra):
                attempt = self.create(catalogue['caseId'])
                for definition in catalogue['investigations']:
                    if definition['role'] == 'essential' or definition['role'] == extra:
                        self.order(attempt, definition, release=definition['role'] == 'essential')
                # Server timestamp order is meaningful for formative sequencing.
                attempt['diagnosisSubmittedAt'] = max(row['orderedAt'] for row in attempt['orders'].values()) + 10
                result, _ = self.evaluate(attempt)
                self.assertEqual(result.status_code, 200)
                result = result.json()
                criterion_ids = {row['criterionId'] for row in attempt['localAiCase']['evaluation']['rubric']
                                 if row['sourceDomain'] == 'investigation'}
                verdicts = [row['verdict'] for row in result['criteria'] if row['criterion_id'] in criterion_ids]
                self.assertTrue(verdicts)
                self.assertEqual(set(verdicts), {'missed'} if extra == 'potentially-harmful' else {'met'})
                priority = next(row for row in result['consultation_management']['indicators']
                                if row['id'] == 'priority-sequencing')
                self.assertEqual(priority['counts']['harmful_orders'], int(extra == 'potentially-harmful'))
                self.assertEqual(priority['status'], 'review-recommended' if extra == 'potentially-harmful' else 'documented')
                self.assertEqual(sum(row['max'] for row in result['domain_scores'].values()), 85)
                self.assertEqual(result['domain_scores']['data_gathering']['max'], 50)
                # Once cached, changed orders do not trigger retrospective regrading.
                cached = copy.deepcopy(result)
                attempt['orders'].clear()
                repeated, provider = self.evaluate(attempt)
                self.assertEqual(repeated.json(), cached)
                provider.health.assert_not_awaited()
                outcomes[extra] = result
        self.assertEqual(catalogue, before_manifest)
        self.assertEqual(outcomes[None]['safety_breach'], outcomes['potentially-harmful']['safety_breach'])

    def test_useful_only_and_no_relevant_orders_keep_existing_partial_and_missed_credit(self):
        catalogue = next(case for case in self.runtime.investigation_cases.values()
                         if any(row['role'] == 'useful' for row in case['investigations']))
        for role, expected in (('useful', 'partially-met'), ('optional', 'missed'), ('not-indicated', 'missed')):
            attempt = self.create(catalogue['caseId'])
            self.order(attempt, next(row for row in catalogue['investigations'] if row['role'] == role))
            response, _ = self.evaluate(attempt)
            ids = {row['criterionId'] for row in attempt['localAiCase']['evaluation']['rubric'] if row['sourceDomain'] == 'investigation'}
            self.assertEqual({row['verdict'] for row in response.json()['criteria'] if row['criterion_id'] in ids}, {expected})

    def test_real_asgi_disconnect_after_record_before_done_replays_once_and_blocks_unreceived_grading(self):
        attempt = self.create(delivery=1)
        aid = attempt['attemptId']
        history = attempt['localAiCase']['patient']['history'][0]
        payload = {'attemptId': aid, 'source': 'predefined', 'questionId': history['id'],
                   'question': history['question'], 'requestId': 'interrupted-after-record-0001'}
        # Actual application/StreamingResponse. The client transport drops exactly
        # the successful terminal, after the real generator recorded its evidence.
        async def interrupted(scope, receive, send):
            async def drop_terminal(message):
                if message['type'] == 'http.response.body' and b'"done":true' in message.get('body', b''):
                    self.assertIn(payload['requestId'], attempt['patientResponses'])
                    raise asyncio.CancelledError()
                await send(message)
            await self.app(scope, receive, drop_terminal)

        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=interrupted, client=('127.0.0.1', 50000)),
                                         base_url=fixtures.ORIGIN, headers={'Origin': fixtures.ORIGIN},
                                         cookies=dict(self.one.cookies)) as client:
                try:
                    await client.post('/agent/patient/stream', json=payload)
                except (asyncio.CancelledError, AssertionError):
                    pass  # ASGITransport correctly refuses an unfinished response.

        asyncio.run(run())
        self.assertFalse(attempt['patientRequestActive'])
        self.assertEqual(len(attempt['transcript']), 3)
        response, provider = self.evaluate(attempt)
        self.assertEqual(response.status_code, 409)
        provider.health.assert_not_awaited()
        self.assertIsNone(attempt['evaluationResult'])
        view = self.one.get(f'/api/attempts/{aid}/recovery').json()
        self.assertEqual(view['pendingDialogueRequestIds'], [payload['requestId']])
        self.assertEqual([row.get('requestId') for row in view['transcript'][-2:]], [payload['requestId']] * 2)
        with patch('medsim_backend.services.patient_dialogue_service.get_local_llm_provider', side_effect=AssertionError('Replay must not infer')):
            replay = self.one.post('/agent/patient/stream', json=payload)
        self.assertEqual(replay.text.count('"done":true'), 1)
        self.assertEqual(len(attempt['transcript']), 3)
        for _ in range(2):
            receipt = self.one.post(f'/api/attempts/{aid}/dialogue/acknowledgements', json={'requestId': payload['requestId']})
            self.assertEqual(receipt.status_code, 200)
        self.assertEqual(self.one.get(f'/api/attempts/{aid}/recovery').json()['pendingDialogueRequestIds'], [])
        self.assertEqual((len(attempt['transcript']), attempt['askedQuestionIds'].count(history['id'])), (3, 1))
        self.assertEqual(self.two.post(f'/api/attempts/{aid}/dialogue/acknowledgements', json={'requestId': payload['requestId']}).status_code, 404)
        other = self.create(delivery=1)
        self.assertEqual(self.one.post(f"/api/attempts/{other['attemptId']}/dialogue/acknowledgements", json={'requestId': payload['requestId']}).status_code, 404)
        self.assertEqual(self.one.post('/agent/patient/stream', json={**payload, 'question': 'Different question'}).status_code, 409)
        self.assertEqual(self.evaluate(attempt)[0].status_code, 200)

    def test_pilot_override_is_process_local_and_does_not_change_general_or_nonpilot_deadlines(self):
        with patch.dict(os.environ, {'MEDSIM_PILOT_MODE': '1', 'OPENROUTER_PATIENT_TIMEOUT_SECONDS': '3',
                                   'OPENROUTER_SEMANTIC_TIMEOUT_SECONDS': '3.2', 'OPENROUTER_TIMEOUT_SECONDS': '7'}):
            configure_pilot_dialogue()
            settings = LocalLLMSettings.from_env()
            self.assertEqual((settings.patient_timeout_seconds, settings.hosted_semantic_timeout_seconds, settings.timeout_seconds), (7.8, 8, 7))
            baseline = replace(settings, patient_timeout_seconds=3, hosted_semantic_timeout_seconds=3.2)
        with patch.dict(os.environ, {'MEDSIM_PILOT_MODE': '0', 'OPENROUTER_PATIENT_TIMEOUT_SECONDS': '3',
                                   'OPENROUTER_SEMANTIC_TIMEOUT_SECONDS': '3.2'}):
            configure_pilot_dialogue()
            settings = LocalLLMSettings.from_env()
            self.assertEqual((settings.patient_timeout_seconds, settings.hosted_semantic_timeout_seconds),
                             (baseline.patient_timeout_seconds, baseline.hosted_semantic_timeout_seconds))

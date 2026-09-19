from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path

import httpx

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from local_llm import (  # noqa: E402
    ChatRequest, DisabledLocalProvider, LLMProviderError, LocalLLMSettings,
    OpenRouterLLMProvider, StructuredRequest, build_provider,
)

MINI = "nex-agi/nex-n2.5-mini:free"
PRO = "nex-agi/nex-n2.5-pro:free"


def settings(**overrides):
    values = {
        "provider": "openrouter", "base_url": "https://openrouter.ai/api/v1",
        "patient_model": MINI, "api_key": "test-key-not-a-secret",
        "allow_paid_models": False, "max_retries": 0, "timeout_seconds": 5,
    }
    values.update(overrides)
    configured = LocalLLMSettings(**values)
    configured.validate()
    return configured


def completion(model: str, content: str = "I have noticed that in spring, doctor.", reasoning_tokens: int = 0) -> httpx.Response:
    return httpx.Response(200, json={
        "model": model, "choices": [{"message": {"content": content}}],
        "usage": {"completion_tokens_details": {"reasoning_tokens": reasoning_tokens}},
    })


class OpenRouterProviderTests(unittest.TestCase):
    def test_primary_selection_can_pin_mini_or_pro(self):
        for primary in (MINI, PRO):
            captured = {}

            def handler(request):
                captured.update(json.loads(request.content))
                return completion(primary)

            result = asyncio.run(OpenRouterLLMProvider(
                settings(patient_model=primary), httpx.MockTransport(handler),
            ).complete_chat(ChatRequest("system", [], 80, request_id="selection")))
            self.assertEqual(captured["model"], primary)
            self.assertEqual(result.actual_model, primary)

    def test_missing_key_is_safe_and_does_not_call_network(self):
        called = False

        def handler(request):
            nonlocal called
            called = True
            return httpx.Response(500)

        health = asyncio.run(OpenRouterLLMProvider(settings(api_key=""), httpx.MockTransport(handler)).health())
        self.assertEqual((health.state, health.last_error_category), ("configuration-missing", "missing-api-key"))
        self.assertFalse(called)

    def test_only_specific_free_nex_models_are_accepted(self):
        for model in ("openrouter/free", "openrouter/auto", "qwen/paid", "other/model:free"):
            with self.subTest(model=model), self.assertRaisesRegex(ValueError, "approved specific Nex"):
                settings(patient_model=model)
        with self.assertRaisesRegex(ValueError, "Paid"):
            settings(allow_paid_models=True)
        with self.assertRaisesRegex(ValueError, "distinct"):
            settings(fallback_models=(MINI,))
        with self.assertRaisesRegex(ValueError, "at most one"):
            settings(fallback_models=(PRO, MINI))

    def test_catalogue_verifies_primary_free_model_and_capabilities(self):
        def handler(request):
            return httpx.Response(200, json={"data": [{
                "id": MINI, "context_length": 262144,
                "pricing": {"prompt": "0", "completion": "0"},
                "supported_parameters": ["reasoning", "response_format", "structured_outputs"],
            }]})

        health = asyncio.run(OpenRouterLLMProvider(settings(), httpx.MockTransport(handler)).health())
        self.assertEqual(health.state, "ready")
        self.assertEqual(health.catalog_context_length, 262144)
        self.assertTrue(health.supports_structured_outputs)

    def test_patient_payload_disables_reasoning_and_has_strict_limit(self):
        captured = {}

        def handler(request):
            captured.update(json.loads(request.content))
            return completion(MINI)

        provider = OpenRouterLLMProvider(settings(), httpx.MockTransport(handler))
        result = asyncio.run(provider.complete_chat(ChatRequest("system", [], 80, temperature=0.1, request_id="patient-1")))
        self.assertEqual((result.actual_model, result.reasoning_tokens), (MINI, 0))
        self.assertEqual(captured["reasoning"], {"effort": "none"})
        self.assertEqual(captured["max_tokens"], 80)
        self.assertLessEqual(captured["max_tokens"], 100)
        self.assertEqual(captured["temperature"], 0.1)
        self.assertEqual(captured["model"], MINI)
        self.assertNotIn("models", captured)
        self.assertFalse(captured["provider"]["allow_fallbacks"])
        self.assertTrue(captured["provider"]["require_parameters"])

    def test_primary_failure_never_chains_a_second_model(self):
        models = []

        def handler(request):
            model = json.loads(request.content)["model"]
            models.append(model)
            return httpx.Response(503) if model == MINI else completion(PRO)

        provider = OpenRouterLLMProvider(settings(fallback_models=(PRO,), enable_pro_fallback=True), httpx.MockTransport(handler))
        with self.assertRaises(LLMProviderError):
            asyncio.run(provider.complete_chat(ChatRequest("system", [], 80, request_id="fallback-1")))
        self.assertEqual(models, [MINI])

    def test_primary_timeout_does_not_start_a_second_hosted_timeout(self):
        models = []

        async def handler(request):
            model = json.loads(request.content)["model"]
            models.append(model)
            if model == MINI:
                await asyncio.sleep(0.05)
            return completion(PRO)

        configured = settings(fallback_models=(PRO,), enable_pro_fallback=True)
        object.__setattr__(configured, "patient_timeout_seconds", 0.01)
        with self.assertRaises(LLMProviderError) as raised:
            asyncio.run(OpenRouterLLMProvider(configured, httpx.MockTransport(handler)).complete_chat(
                ChatRequest("system", [], 80, request_id="timeout-fallback"),
            ))
        self.assertEqual(models, [MINI])
        self.assertEqual(raised.exception.category, "response-timeout")

    def test_patient_deadline_cannot_exceed_three_seconds(self):
        configured = settings()
        self.assertLessEqual(configured.patient_timeout_seconds, 3)
        with self.assertRaisesRegex(ValueError, "between 0.5 and 3"):
            settings(patient_timeout_seconds=3.01)

    def test_configured_fallback_is_never_randomly_routed(self):
        calls = []

        def handler(request):
            calls.append(json.loads(request.content)["model"])
            return httpx.Response(503, text="private upstream body")

        provider = OpenRouterLLMProvider(settings(fallback_models=(PRO,), enable_pro_fallback=True), httpx.MockTransport(handler))
        with self.assertRaises(LLMProviderError) as raised:
            asyncio.run(provider.complete_chat(ChatRequest("system", [], 80, request_id="both-down")))
        self.assertEqual(calls, [MINI])
        self.assertEqual(raised.exception.category, "model-unavailable")
        self.assertNotIn("private upstream body", str(raised.exception))

    def test_reasoning_tokens_are_rejected_without_chaining(self):
        def handler(request):
            model = json.loads(request.content)["model"]
            return completion(MINI, "unsafe", 12) if model == MINI else completion(PRO)

        provider = OpenRouterLLMProvider(settings(fallback_models=(PRO,), enable_pro_fallback=True), httpx.MockTransport(handler))
        with self.assertRaises(LLMProviderError) as raised:
            asyncio.run(provider.complete_chat(ChatRequest("system", [], 80, request_id="reasoning-check")))
        self.assertEqual(raised.exception.category, "reasoning-not-disabled")

    def test_structured_result_records_actual_model_and_reasoning_disabled(self):
        captured = {}

        def handler(request):
            captured.update(json.loads(request.content))
            return completion(PRO, '{"criteria":[]}')

        provider = OpenRouterLLMProvider(settings(patient_model=PRO), httpx.MockTransport(handler))
        result = asyncio.run(provider.structured_completion(
            StructuredRequest("system", "evidence", 20, request_id="eval-correlation"), {"type": "object"},
        ))
        self.assertEqual(result.actual_model, PRO)
        self.assertEqual(captured["reasoning"], {"effort": "none"})
        self.assertNotIn("models", captured)
        self.assertFalse(captured["provider"]["allow_fallbacks"])

    def test_local_provider_is_disabled_unless_explicitly_enabled(self):
        configured = LocalLLMSettings(
            provider="llama_cpp", base_url="http://127.0.0.1:8080/v1",
            patient_model="qwen3-local", local_llm_enabled=False,
        )
        self.assertIsInstance(build_provider(configured), DisabledLocalProvider)


if __name__ == "__main__":
    unittest.main()

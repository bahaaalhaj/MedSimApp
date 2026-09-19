from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from tts.providers import (
    ChatterboxTTSProvider,
    DisabledTTSProvider,
    KokoroTTSProvider,
    TTSManager,
    TTSRequest,
    TTSResult,
    TTSConfigurationError,
    load_tts_settings,
    normalize_for_speech,
    select_device,
    select_kokoro_voice,
)
from tts.kokoro_cache import inspect_kokoro_cache
import asyncio
from tts.audio_cache import PersistentAudioCache


class TTSConfigurationTests(unittest.TestCase):
    def test_all_curated_cases_map_to_authoritative_gender_voice_family(self):
        from local_ai import LOCAL_AI_CASES
        self.assertEqual(len(LOCAL_AI_CASES), 72)
        for case_id, case in LOCAL_AI_CASES.items():
            patient = case["patient"]
            voice = select_kokoro_voice(case_id, patient["gender"], int(patient["age"]) < 14)
            if int(patient["age"]) >= 14:
                self.assertTrue(voice.startswith("am_") if patient["gender"] == "M" else voice.startswith("af_"), case_id)
        self.assertEqual(select_kokoro_voice("im-003", "M"), "am_adam")
    def test_persistent_cache_round_trip_is_atomic_and_content_addressed(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = PersistentAudioCache(temporary, 64 * 1024 * 1024)
            metadata = cache.metadata(case_version="1", normalized_text="hello", voice="af_heart", speed=1.0, model_revision="rev")
            wav = b"RIFF" + (b"\0" * 4) + b"WAVE" + (b"\0" * 36)
            key = cache.put(metadata, wav)
            self.assertEqual(cache.get(metadata), wav)
            self.assertTrue((Path(temporary) / f"{key}.wav").exists())
            self.assertFalse(list(Path(temporary).glob("*.incomplete")))

    def test_kokoro_is_default(self):
        settings = load_tts_settings({})
        self.assertEqual(settings.provider, "kokoro")
        self.assertEqual(settings.device, "auto")
        self.assertEqual(settings.model_cache_dir, "~/.cache/huggingface")

    def test_missing_cache_reports_safe_setup_without_loading_kokoro(self):
        with tempfile.TemporaryDirectory() as temporary:
            inspect_kokoro_cache.cache_clear()
            settings = load_tts_settings({
                "PATIENT_TTS_PROVIDER": "kokoro",
                "PATIENT_TTS_MODEL_CACHE_DIR": temporary,
            })
            health = TTSManager(settings).health()
            self.assertEqual(health["state"], "failed")
            self.assertEqual(health["error_category"], "tts-model-missing")
            self.assertIn("prepare_kokoro.py", str(health["setup_instruction"]))
            self.assertNotIn("kokoro", sys.modules)

    def test_cuda_falls_back_to_cpu(self):
        fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False))
        previous = sys.modules.get("torch")
        sys.modules["torch"] = fake_torch
        try:
            self.assertEqual(select_device("cuda"), "cpu")
        finally:
            if previous is None:
                sys.modules.pop("torch", None)
            else:
                sys.modules["torch"] = previous

    def test_chatterbox_must_be_explicitly_enabled(self):
        with self.assertRaises(TTSConfigurationError):
            load_tts_settings({"PATIENT_TTS_PROVIDER": "chatterbox"})
        self.assertNotIn("chatterbox", sys.modules)

    def test_chatterbox_constructor_does_not_load_model(self):
        settings = load_tts_settings({
            "PATIENT_TTS_PROVIDER": "chatterbox",
            "PATIENT_TTS_ENABLE_CHATTERBOX": "true",
            "PATIENT_TTS_DEVICE": "cpu",
        })
        provider = ChatterboxTTSProvider(settings)
        self.assertIsNone(provider._model)
        self.assertNotIn("chatterbox.tts_turbo", sys.modules)

    def test_disabled_provider_fails_cleanly_without_audio(self):
        with self.assertRaisesRegex(RuntimeError, "text response is still available"):
            asyncio.run(DisabledTTSProvider().synthesize(None))  # type: ignore[arg-type]

    def test_provider_switching_is_configuration_controlled(self):
        self.assertEqual(load_tts_settings({"PATIENT_TTS_PROVIDER": "disabled"}).provider, "disabled")
        with self.assertRaises(TTSConfigurationError):
            load_tts_settings({"PATIENT_TTS_PROVIDER": "not-a-provider"})

    def test_pronunciation_normalization_is_separate_from_transcript(self):
        self.assertEqual(normalize_for_speech("BP 120 mmHg [hidden]"), "blood pressure 120 millimetres of mercury hidden")

    def test_background_preload_is_single_and_reports_ready(self):
        async def run():
            manager = TTSManager(load_tts_settings({"PATIENT_TTS_DEVICE": "cpu"}))
            provider = KokoroTTSProvider(manager.settings)
            provider.warm_up = AsyncMock()  # type: ignore[method-assign]
            manager._provider = provider
            status = types.SimpleNamespace(ready=True, revision="test-revision", public_dict=lambda: {"state": "ready"})
            with patch("tts.providers.inspect_kokoro_cache", return_value=status):
                first = manager.start_preload()
                second = manager.start_preload()
                self.assertIs(first, second)
                self.assertEqual(manager.health()["state"], "loading")
                await first
                self.assertEqual(manager.health()["state"], "ready")
                provider.warm_up.assert_awaited_once()
        asyncio.run(run())

    def test_opening_greeting_audio_cache_is_bounded_and_reused(self):
        async def run():
            manager = TTSManager(load_tts_settings({"PATIENT_TTS_DEVICE": "cpu"}))
            provider = KokoroTTSProvider(manager.settings)
            expected = TTSResult(b"wav", "audio/wav", 24000, "kokoro", "af_heart", "Hello.", "Hello.")
            provider.synthesize = AsyncMock(return_value=expected)  # type: ignore[method-assign]
            manager._provider = provider
            request = TTSRequest("Hello.", "case-1", "F", case_version="1.1.0", is_opening_greeting=True)
            first = await manager.synthesize(request)
            second = await manager.synthesize(request)
            self.assertFalse(first.cache_hit)
            self.assertTrue(second.cache_hit)
            provider.synthesize.assert_awaited_once()
            self.assertEqual(len(manager._audio_cache), 1)
        asyncio.run(run())

    def test_authored_audio_cache_key_includes_version_voice_speed_and_revision(self):
        manager = TTSManager(load_tts_settings({"PATIENT_TTS_DEVICE": "cpu"}))
        provider = KokoroTTSProvider(manager.settings)
        manager._provider = provider
        base = TTSRequest("It usually happens in spring.", "case-1", "F", case_version="1", cacheable=True)
        with patch("tts.providers.kokoro_cache_revision", return_value="rev-a"):
            key = manager._cache_key(base, provider)
            self.assertNotEqual(key, manager._cache_key(TTSRequest(**{**base.__dict__, "case_version": "2"}), provider))
            self.assertNotEqual(key, manager._cache_key(TTSRequest(**{**base.__dict__, "gender": "M"}), provider))
            self.assertNotEqual(key, manager._cache_key(TTSRequest(**{**base.__dict__, "speed": 1.1}), provider))
        with patch("tts.providers.kokoro_cache_revision", return_value="rev-b"):
            self.assertNotEqual(key, manager._cache_key(base, provider))


if __name__ == "__main__":
    unittest.main()

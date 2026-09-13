from __future__ import annotations

import sys
import types
import unittest

from tts.providers import (
    ChatterboxTTSProvider,
    DisabledTTSProvider,
    TTSConfigurationError,
    load_tts_settings,
    normalize_for_speech,
    select_device,
)
import asyncio


class TTSConfigurationTests(unittest.TestCase):
    def test_kokoro_is_default(self):
        settings = load_tts_settings({})
        self.assertEqual(settings.provider, "kokoro")
        self.assertEqual(settings.device, "auto")

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


if __name__ == "__main__":
    unittest.main()

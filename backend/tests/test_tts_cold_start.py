"""No Torch, Kokoro weights, downloads, or live inference in these tests."""
from __future__ import annotations

import asyncio
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tts.providers import KokoroTTSProvider, TTSManager, TTSRequest, TTSResult, load_tts_settings


class ColdStartTests(unittest.TestCase):
    def test_preload_and_concurrent_dynamic_requests_initialize_once(self):
        async def run(directory):
            import numpy as np
            factory = Mock(return_value=lambda *args, **kwargs: iter([("", "", np.zeros(24))]))
            manager = TTSManager(load_tts_settings({"PATIENT_TTS_DEVICE": "cpu", "PATIENT_TTS_AUDIO_CACHE_DIR": directory}))
            with patch.dict(sys.modules, {"kokoro": types.SimpleNamespace(KPipeline=factory)}), patch("tts.providers.enable_verified_offline_cache"), patch("tts.providers._require_local_english_model"), patch("tts.providers.inspect_kokoro_cache", return_value=types.SimpleNamespace(ready=True)), patch("tts.providers.kokoro_cache_revision", return_value="test"), patch.object(manager, "_prepare_common_templates", new_callable=AsyncMock):
                first = manager.start_background_preload()
                self.assertIs(first, manager.start_background_preload())
                await first
                provider = manager.provider()
                self.assertEqual((provider.load_count, provider.warm_up_count), (1, 1))
                requests = [TTSRequest(f"Dynamic answer {i}.", "im-003", case_version="1", cacheable=True) for i in range(2)]
                results = await asyncio.gather(*(manager.synthesize(r) for r in requests))
                self.assertTrue(all(dict(r.timings)["tts-init"] == 0 for r in results))
                factory.assert_called_once()
                self.assertEqual(provider.load_count, 1)
        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(run(directory))

    def test_cold_then_warm_dynamic_and_persistent_cache_without_loader(self):
        async def run(directory):
            import numpy as np
            factory = Mock(return_value=lambda *args, **kwargs: iter([("", "", np.zeros(24))]))
            settings = load_tts_settings({"PATIENT_TTS_DEVICE": "cpu", "PATIENT_TTS_AUDIO_CACHE_DIR": directory})
            manager = TTSManager(settings)
            request = TTSRequest("An authored dynamic answer.", "im-003", case_version="1", cacheable=True)
            with patch.dict(sys.modules, {"kokoro": types.SimpleNamespace(KPipeline=factory)}), patch("tts.providers.enable_verified_offline_cache"), patch("tts.providers._require_local_english_model"), patch("tts.providers.kokoro_cache_revision", return_value="test"):
                cold = await manager.synthesize(request)
                warm = await manager.synthesize(replace(request, text="Another authored answer."))
                self.assertFalse(cold.cache_hit)
                self.assertGreater(dict(cold.timings)["tts-init"], 0)
                self.assertEqual(dict(warm.timings)["tts-init"], 0)
                disk_only = TTSManager(settings)
                with patch.object(KokoroTTSProvider, "_load", side_effect=AssertionError("cache hit loaded model")), patch("tts.providers.select_device", side_effect=AssertionError("cache hit probed Torch")):
                    hit = await disk_only.synthesize(request)
                self.assertTrue(hit.cache_hit)
                self.assertEqual(hit.audio, cold.audio)
                self.assertEqual(disk_only.provider().load_count, 0)
                self.assertEqual(factory.call_count, 1)
        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(run(directory))

    def test_missing_or_invalid_offline_cache_never_starts_provider(self):
        async def run():
            for state in ("tts-model-missing", "tts-model-invalid"):
                manager = TTSManager(load_tts_settings({}))
                with patch("tts.providers.inspect_kokoro_cache", return_value=types.SimpleNamespace(ready=False, state=state)), patch.object(manager, "provider", side_effect=AssertionError("must not load")):
                    await manager.start_background_preload()
                self.assertIsNone(manager._preload_task)
                self.assertEqual(manager._error_category, state)
        asyncio.run(run())

    def test_missing_english_package_cannot_trigger_misaki_runtime_download(self):
        import importlib.metadata
        from tts.providers import TTSProviderError
        provider = KokoroTTSProvider(load_tts_settings({}))
        with patch("tts.providers.enable_verified_offline_cache"), patch("tts.providers.importlib.metadata.distribution", side_effect=importlib.metadata.PackageNotFoundError), patch("tts.providers.select_device") as probe:
            with self.assertRaisesRegex(TTSProviderError, "runtime downloads are disabled"):
                provider._load()
        probe.assert_not_called()
        self.assertEqual(provider.load_count, 0)

    def test_common_templates_cover_all_existing_voices_and_are_bounded(self):
        async def run():
            manager = TTSManager(load_tts_settings({}))
            with patch.object(manager, "_prepare_template", new_callable=AsyncMock) as synth:
                await manager._prepare_common_templates()
            calls = [call.args[0] for call in synth.await_args_list]
            from tts.providers import select_kokoro_voice
            self.assertEqual(len(calls), 16)
            self.assertEqual({select_kokoro_voice(r.case_id, r.gender, r.is_pediatric) for r in calls}, {"am_adam", "am_michael", "af_heart", "af_bella"})
            self.assertTrue(all(r.cacheable and r.case_version and not r.request_id for r in calls))
        asyncio.run(run())

    def test_template_preparation_coalesces_and_does_not_reserve_foreground_queue(self):
        async def run(directory):
            manager = TTSManager(load_tts_settings({"PATIENT_TTS_AUDIO_CACHE_DIR": directory}))
            provider = KokoroTTSProvider(manager.settings)
            manager._provider = provider
            started, release = asyncio.Event(), asyncio.Event()
            calls = []
            async def synthesize(request):
                async with provider._inference_lock:
                    calls.append(request.text)
                    if request.text == "Common template.":
                        started.set()
                        await release.wait()
                    wav = b"RIFF" + b"\0" * 4 + b"WAVE" + b"\0" * 36
                    return TTSResult(wav, "audio/wav", 24000, "kokoro", "am_adam", request.text, request.text)
            provider.synthesize = synthesize
            request = TTSRequest("Common template.", "im-003", case_version="1", cacheable=True)
            with patch("tts.providers.kokoro_cache_revision", return_value="test"):
                prepared = asyncio.create_task(manager._prepare_template(request))
                await started.wait()
                self.assertFalse(manager._synthesis_slot.locked())
                duplicate = asyncio.create_task(manager.synthesize(request))
                foreground = asyncio.create_task(manager.synthesize(replace(request, text="Foreground answer.")))
                for _ in range(5):
                    await asyncio.sleep(0)
                release.set()
                await asyncio.gather(prepared, duplicate, foreground)
                self.assertEqual(calls, ["Common template.", "Foreground answer."])
                self.assertTrue((await manager.synthesize(request)).cache_hit)
        with tempfile.TemporaryDirectory() as directory:
            asyncio.run(run(directory))

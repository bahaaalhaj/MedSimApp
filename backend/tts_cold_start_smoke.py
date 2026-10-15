"""Opt-in, offline-only Kokoro timing smoke. All WAVs live in temporary storage."""
from __future__ import annotations

import argparse
import asyncio
import json
import tempfile
import time
from dataclasses import replace
from pathlib import Path

from tts.providers import TTSManager, TTSRequest, load_tts_settings
from tts.kokoro_cache import inspect_kokoro_cache


async def measure() -> dict:
    settings = load_tts_settings()
    if settings.provider != "kokoro" or not inspect_kokoro_cache(settings.model_cache_dir).ready:
        return {"state": "skipped", "reason": "verified local Kokoro cache required; no download attempted"}
    with tempfile.TemporaryDirectory(prefix="medsim-cold-start-") as directory:
        manager = TTSManager(replace(settings, audio_cache_dir=directory))
        request = TTSRequest("Information about my current medication is not documented in this case.",
                             "im-003", "M", case_version="1.1.0", cacheable=True, request_id="cold-start-smoke")
        rows = []
        async def synth(label, req):
            started = time.perf_counter()
            result = await manager.synthesize(req)
            rows.append({"step": label, "totalMs": round((time.perf_counter() - started) * 1000, 3),
                         "cache": "hit" if result.cache_hit else "miss", "voice": result.voice,
                         "timingsMs": dict(result.timings), "wav": result.audio.startswith(b"RIFF")})
        await synth("cold-dynamic-without-preload", request)
        started = time.perf_counter()
        first = manager.start_preload()
        assert first is manager.start_preload()
        await first
        rows.append({"step": "preload-reuses-resident-model", "totalMs": round((time.perf_counter() - started) * 1000, 3)})
        await synth("warm-new-dynamic", replace(request, text="I'm not sure what treatment I need, doctor. What would you recommend?"))
        await synth("warm-memory-cache", request)
        manager._audio_cache.clear()  # Force the persisted WAV read, not synthesis.
        await synth("persistent-cache", request)
        provider = manager.provider()
        return {"state": "completed", "method": "verified offline weights, no network providers, one manager; not a browser measurement",
                "device": provider.device, "initializationCount": provider.load_count, "warmUpCount": provider.warm_up_count,
                "initializationStartedAtMs": provider.initialization_started_at, "modelReadyAtMs": provider.model_ready_at,
                "rows": rows, "audioStorage": "temporary directory removed on exit"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(Path(__file__).resolve().parents[1] / "docs" / "development"):
        parser.error("output must be within docs/development")
    result = asyncio.run(measure())
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))

"""Benchmark the configured local patient TTS provider without saving audio."""
from __future__ import annotations

import argparse
import asyncio
import time
import tracemalloc
import wave
from io import BytesIO

from tts import TTSRequest, get_tts_manager


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default="I have had this pain for about three days, doctor.")
    args = parser.parse_args()
    manager = get_tts_manager()
    tracemalloc.start()
    provider = manager.provider()
    load_started = time.perf_counter()
    loader = getattr(provider, "_load", None)
    if loader is not None:
        await asyncio.to_thread(loader)
    load_seconds = time.perf_counter() - load_started
    started = time.perf_counter()
    result = await manager.synthesize(TTSRequest(args.text, "benchmark", "F"))
    total = time.perf_counter() - started
    with wave.open(BytesIO(result.audio), "rb") as wav:
        duration = wav.getnframes() / wav.getframerate()
    _current, peak = tracemalloc.get_traced_memory()
    print(f"provider={result.provider}")
    print(f"device={getattr(provider, 'device', 'none')}")
    print(f"model_load_seconds={load_seconds:.3f}")
    print(f"time_to_first_audio_seconds={total:.3f} (buffered WAV endpoint)")
    print(f"total_synthesis_seconds={total:.3f}")
    print(f"audio_duration_seconds={duration:.3f}")
    print(f"real_time_factor={total / duration:.3f}")
    print(f"peak_python_allocations_mb={peak / 1024 / 1024:.1f} (native model memory not included)")


if __name__ == "__main__":
    asyncio.run(main())

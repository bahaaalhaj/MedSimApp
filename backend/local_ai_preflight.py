"""Read-only local-AI startup preflight. Prints safe JSON; never loads weights."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from local_llm import _available_memory, _detected_gpu


def report() -> dict[str, object]:
    root = Path(__file__).resolve().parents[1]
    primary = root / "backend/data/llm-models/Qwen3-4B-Q4_K_M.gguf"
    fallback = root / "backend/data/llm-models/Qwen3-1.7B-Q8_0.gguf"
    complete = {
        primary: primary.exists() and primary.stat().st_size == 2_497_280_256,
        fallback: fallback.exists() and fallback.stat().st_size == 1_834_426_016,
    }
    available = _available_memory()
    # Leave room for Windows, Vite/Three.js and the measured ~2.1 GB Kokoro peak.
    prefer_fallback = available is not None and available < 3_200_000_000
    if prefer_fallback:
        selected = fallback
    else:
        selected = primary if complete[primary] else fallback
    safety = "safe"
    if available is not None and available < 2_500_000_000:
        safety = "unsafe-low-memory"
    elif prefer_fallback and complete[fallback]:
        safety = "constrained-use-fallback"
    elif not complete[selected]:
        safety = "unavailable-model-file"
    return {
        "available_ram_bytes": available,
        "available_disk_bytes": shutil.disk_usage(root).free,
        "selected_model": selected.name,
        "selected_model_path": str(selected.relative_to(root)),
        "model_file_bytes": selected.stat().st_size if selected.exists() else None,
        "context_size": 4096,
        "gpu_offload": "auto",
        "detected_gpu": _detected_gpu(),
        "max_concurrency": 1,
        "tts_policy": "kokoro-cpu-only; chatterbox-disabled",
        "safety_status": safety,
        "ready": complete[selected] and safety != "unsafe-low-memory",
    }


if __name__ == "__main__":
    print(json.dumps(report(), indent=2))

"""Explicitly prepare the canonical Kokoro cache, then verify every asset."""
from __future__ import annotations

import os

from tts.kokoro_cache import (
    KOKORO_FILES, KOKORO_REPO_ID, inspect_kokoro_cache, resolve_cache_dir,
)


def main() -> int:
    cache_value = os.environ.get("PATIENT_TTS_MODEL_CACHE_DIR", "~/.cache/huggingface")
    cache_dir = resolve_cache_dir(cache_value)
    os.environ["HF_HOME"] = str(cache_dir)
    os.environ["HF_HUB_CACHE"] = str(cache_dir / "hub")
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

    from huggingface_hub import hf_hub_download

    before = inspect_kokoro_cache(cache_value)
    wanted = set(before.missing_files) | set(before.invalid_files)
    for filename in KOKORO_FILES:
        if filename not in wanted:
            print(f"verified-existing={filename}")
            continue
        print(f"preparing={filename}")
        hf_hub_download(
            repo_id=KOKORO_REPO_ID,
            filename=filename,
            cache_dir=str(cache_dir / "hub"),
            force_download=False,
        )
    inspect_kokoro_cache.cache_clear()
    after = inspect_kokoro_cache(cache_value)
    print(f"kokoro_cache_state={after.state}")
    print("kokoro_cache=~/.cache/huggingface")
    if not after.ready:
        print(f"missing={','.join(after.missing_files)}")
        print(f"invalid={','.join(after.invalid_files)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

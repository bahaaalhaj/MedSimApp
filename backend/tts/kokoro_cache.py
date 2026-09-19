"""Offline Kokoro cache discovery and integrity checks."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
KOKORO_MODEL_FILE = "kokoro-v1_0.pth"
KOKORO_VOICES = ("am_adam", "am_michael", "af_heart", "af_bella")
KOKORO_FILES = ("config.json", KOKORO_MODEL_FILE, *(f"voices/{voice}.pt" for voice in KOKORO_VOICES))
KOKORO_SETUP_COMMAND = "backend/.venv/Scripts/python.exe backend/prepare_kokoro.py"


@dataclass(frozen=True)
class KokoroCacheStatus:
    state: str
    cache_dir: str
    revision: str | None
    missing_files: tuple[str, ...]
    invalid_files: tuple[str, ...]
    setup_instruction: str

    @property
    def ready(self) -> bool:
        return self.state == "ready"

    def public_dict(self) -> dict[str, object]:
        result = asdict(self)
        # The configured portable form is useful; an expanded username is not.
        result["cache_dir"] = "~/.cache/huggingface"
        return result


def resolve_cache_dir(value: str | None) -> Path:
    configured = value or "~/.cache/huggingface"
    path = Path(configured).expanduser()
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return path.resolve()


def kokoro_cache_revision(cache_dir_value: str | None) -> str | None:
    """Read the selected immutable revision without hashing model weights."""
    return _revision(_repo_dir(resolve_cache_dir(cache_dir_value)))


def _repo_dir(cache_dir: Path) -> Path:
    return cache_dir / "hub" / "models--hexgrad--Kokoro-82M"


def _revision(repo_dir: Path) -> str | None:
    ref = repo_dir / "refs" / "main"
    try:
        value = ref.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value if len(value) == 40 and all(char in "0123456789abcdef" for char in value.lower()) else None


def _digest(path: Path, algorithm: str, git_blob: bool = False) -> str:
    digest = hashlib.new(algorithm)
    if git_blob:
        digest.update(f"blob {path.stat().st_size}\0".encode("ascii"))
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _valid_cached_file(path: Path) -> bool:
    try:
        target = path.resolve(strict=True)
        if not target.is_file() or target.stat().st_size == 0:
            return False
        blob_name = target.name.lower()
        if len(blob_name) == 64 and all(char in "0123456789abcdef" for char in blob_name):
            return _digest(target, "sha256") == blob_name
        if len(blob_name) == 40 and all(char in "0123456789abcdef" for char in blob_name):
            return _digest(target, "sha1", git_blob=True) == blob_name
        return False
    except OSError:
        return False


@lru_cache(maxsize=8)
def inspect_kokoro_cache(cache_dir_value: str | None) -> KokoroCacheStatus:
    cache_dir = resolve_cache_dir(cache_dir_value)
    repo_dir = _repo_dir(cache_dir)
    revision = _revision(repo_dir)
    if revision is None:
        return KokoroCacheStatus(
            "tts-model-missing", str(cache_dir), None, KOKORO_FILES, (), KOKORO_SETUP_COMMAND,
        )
    snapshot = repo_dir / "snapshots" / revision
    missing: list[str] = []
    invalid: list[str] = []
    for relative in KOKORO_FILES:
        path = snapshot / Path(relative)
        if not path.exists():
            missing.append(relative)
        elif not _valid_cached_file(path):
            invalid.append(relative)
    if missing or invalid:
        state = "tts-model-missing" if missing else "tts-model-invalid"
        return KokoroCacheStatus(state, str(cache_dir), revision, tuple(missing), tuple(invalid), KOKORO_SETUP_COMMAND)
    try:
        json.loads((snapshot / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        invalid.append("config.json")
        return KokoroCacheStatus(
            "tts-model-invalid", str(cache_dir), revision, (), tuple(dict.fromkeys(invalid)), KOKORO_SETUP_COMMAND,
        )
    return KokoroCacheStatus("ready", str(cache_dir), revision, (), (), KOKORO_SETUP_COMMAND)


def enable_verified_offline_cache(cache_dir_value: str | None) -> KokoroCacheStatus:
    status = inspect_kokoro_cache(cache_dir_value)
    if not status.ready:
        raise RuntimeError(f"{status.state}: Run `{status.setup_instruction}` before starting MedSim.")
    cache_dir = resolve_cache_dir(cache_dir_value)
    os.environ["HF_HOME"] = str(cache_dir)
    os.environ["HF_HUB_CACHE"] = str(cache_dir / "hub")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    return status

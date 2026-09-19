"""Content-addressed persistent cache for patient-safe deterministic WAV audio."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

AUDIO_CACHE_SCHEMA_VERSION = 1
PRONUNCIATION_NORMALIZATION_REVISION = "speech-normalization-v1"


def resolve_audio_cache_dir(value: str | None) -> Path:
    return Path(value or "~/.cache/medsim/tts").expanduser().resolve()


class PersistentAudioCache:
    def __init__(self, directory: str | None, max_bytes: int):
        self.directory = resolve_audio_cache_dir(directory)
        self.max_bytes = max_bytes
        self.manifest_path = self.directory / "manifest.v1.json"
        self._lock = threading.Lock()

    @staticmethod
    def metadata(
        *, case_version: str, normalized_text: str, voice: str, speed: float,
        model_revision: str,
    ) -> dict[str, Any]:
        return {
            "case_version": case_version,
            "text_sha256": hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
            "voice": voice,
            "speed": round(speed, 3),
            "model_revision": model_revision,
            "pronunciation_revision": PRONUNCIATION_NORMALIZATION_REVISION,
        }

    @staticmethod
    def key(metadata: dict[str, Any]) -> str:
        encoded = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    def _empty_manifest(self) -> dict[str, Any]:
        return {"schema_version": AUDIO_CACHE_SCHEMA_VERSION, "entries": {}}

    def _read_manifest(self) -> dict[str, Any]:
        try:
            manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
            if manifest.get("schema_version") != AUDIO_CACHE_SCHEMA_VERSION or not isinstance(manifest.get("entries"), dict):
                return self._empty_manifest()
            return manifest
        except (OSError, ValueError, TypeError):
            return self._empty_manifest()

    def _write_manifest(self, manifest: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="manifest.", suffix=".tmp", dir=self.directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as target:
                json.dump(manifest, target, sort_keys=True, separators=(",", ":"))
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.manifest_path)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    @staticmethod
    def _valid_wav(data: bytes) -> bool:
        return len(data) >= 44 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"

    def get(self, metadata: dict[str, Any]) -> bytes | None:
        key = self.key(metadata)
        with self._lock:
            manifest = self._read_manifest()
            entry = manifest["entries"].get(key)
            if not isinstance(entry, dict) or any(entry.get(name) != value for name, value in metadata.items()):
                return None
            path = self.directory / f"{key}.wav"
            try:
                data = path.read_bytes()
            except OSError:
                return None
            if (
                len(data) != entry.get("size")
                or hashlib.sha256(data).hexdigest() != entry.get("audio_sha256")
                or not self._valid_wav(data)
            ):
                return None
            entry["accessed_at"] = int(time.time())
            self._write_manifest(manifest)
            return data

    def put(self, metadata: dict[str, Any], audio: bytes) -> str:
        if not self._valid_wav(audio):
            raise ValueError("Only complete WAV audio can enter the persistent cache")
        key = self.key(metadata)
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            target = self.directory / f"{key}.wav"
            fd, temporary = tempfile.mkstemp(prefix=f"{key}.", suffix=".incomplete", dir=self.directory)
            try:
                with os.fdopen(fd, "wb") as output:
                    output.write(audio)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            finally:
                try:
                    os.unlink(temporary)
                except FileNotFoundError:
                    pass
            manifest = self._read_manifest()
            now = int(time.time())
            manifest["entries"][key] = {
                **metadata, "file": target.name, "size": len(audio),
                "audio_sha256": hashlib.sha256(audio).hexdigest(),
                "created_at": now, "accessed_at": now,
            }
            self._cleanup(manifest, keep=key)
            self._write_manifest(manifest)
        return key

    def _cleanup(self, manifest: dict[str, Any], keep: str) -> None:
        entries = manifest["entries"]
        total = sum(int(item.get("size", 0)) for item in entries.values() if isinstance(item, dict))
        if total <= self.max_bytes:
            return
        ordered = sorted(entries.items(), key=lambda pair: int(pair[1].get("accessed_at", 0)))
        for key, entry in ordered:
            if total <= self.max_bytes:
                break
            if key == keep:
                continue
            try:
                (self.directory / f"{key}.wav").unlink()
            except FileNotFoundError:
                pass
            total -= int(entry.get("size", 0))
            entries.pop(key, None)

    def stats(self) -> dict[str, int | str]:
        with self._lock:
            manifest = self._read_manifest()
            entries = list(manifest["entries"].values())
            return {
                "directory": str(self.directory),
                "entries": len(entries),
                "bytes": sum(int(item.get("size", 0)) for item in entries if isinstance(item, dict)),
                "max_bytes": self.max_bytes,
            }

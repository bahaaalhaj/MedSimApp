from __future__ import annotations

import asyncio
import io
import os
import re
import threading
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class TTSConfigurationError(ValueError):
    pass


class TTSProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class TTSSettings:
    provider: str = "kokoro"
    device: str = "auto"
    fallback: str = "disabled"
    model_cache_dir: str | None = None
    enable_chatterbox: bool = False
    speed: float = 1.0
    language: str = "en"


@dataclass(frozen=True)
class TTSRequest:
    text: str
    case_id: str
    gender: str = "M"
    is_pediatric: bool = False
    speed: float | None = None
    language: str = "en"
    trusted_expressions: tuple[str, ...] = ()


@dataclass(frozen=True)
class TTSResult:
    audio: bytes
    media_type: str
    sample_rate: int
    provider: str
    voice: str
    transcript_text: str
    synthesized_text: str


def load_tts_settings(env: dict[str, str] | None = None) -> TTSSettings:
    values = os.environ if env is None else env
    provider = values.get("PATIENT_TTS_PROVIDER", "kokoro").strip().lower()
    fallback = values.get("PATIENT_TTS_FALLBACK", "disabled").strip().lower()
    device = values.get("PATIENT_TTS_DEVICE", "auto").strip().lower()
    enabled = values.get("PATIENT_TTS_ENABLE_CHATTERBOX", "false").strip().lower() in {"1", "true", "yes", "on"}
    language = values.get("PATIENT_TTS_LANGUAGE", "en").strip().lower()
    try:
        speed = float(values.get("PATIENT_TTS_SPEED", "1.0"))
    except ValueError as exc:
        raise TTSConfigurationError("PATIENT_TTS_SPEED must be a number") from exc
    if provider not in {"kokoro", "chatterbox", "disabled"}:
        raise TTSConfigurationError("PATIENT_TTS_PROVIDER must be kokoro, chatterbox, or disabled")
    if fallback not in {"disabled", "kokoro"}:
        raise TTSConfigurationError("PATIENT_TTS_FALLBACK must be disabled or kokoro")
    if device not in {"auto", "cuda", "cpu"}:
        raise TTSConfigurationError("PATIENT_TTS_DEVICE must be auto, cuda, or cpu")
    if not 0.7 <= speed <= 1.3:
        raise TTSConfigurationError("PATIENT_TTS_SPEED must be between 0.7 and 1.3")
    if provider == "chatterbox" and not enabled:
        raise TTSConfigurationError("Chatterbox requires PATIENT_TTS_ENABLE_CHATTERBOX=true")
    if language not in {"en", "ar"}:
        raise TTSConfigurationError("PATIENT_TTS_LANGUAGE must be en or ar")
    if language == "ar" and provider != "chatterbox":
        raise TTSConfigurationError("Arabic synthesis requires the optional Chatterbox provider")
    cache = values.get("PATIENT_TTS_MODEL_CACHE_DIR", "").strip() or None
    return TTSSettings(provider, device, fallback, cache, enabled, speed, language)


def select_device(requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    try:
        import torch
        available = bool(torch.cuda.is_available())
    except Exception:
        available = False
    if requested == "cuda" and not available:
        return "cpu"
    return "cuda" if available else "cpu"


_ABBREVIATIONS = {
    "BP": "blood pressure", "HR": "heart rate", "RR": "respiratory rate",
    "SpO2": "oxygen saturation", "ECG": "E C G", "HbA1c": "H B A one C",
    "mg": "milligrams", "mcg": "micrograms", "mL": "millilitres",
    "mmHg": "millimetres of mercury", "bpm": "beats per minute",
}


def normalize_for_speech(text: str) -> str:
    """Pronunciation-only normalization; the transcript remains untouched."""
    clean = re.sub(r"[\[\]{}<>]", "", text)
    for source, target in _ABBREVIATIONS.items():
        clean = re.sub(rf"\b{re.escape(source)}\b", target, clean, flags=re.IGNORECASE)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def _stable_hash(value: str) -> int:
    h = 0x811C9DC5
    for char in value:
        h ^= ord(char)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _wav_bytes(samples: Any, sample_rate: int) -> bytes:
    import numpy as np
    pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
    pcm = np.clip(pcm, -1.0, 1.0)
    encoded = (pcm * 32767.0).astype("<i2").tobytes()
    target = io.BytesIO()
    with wave.open(target, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(encoded)
    return target.getvalue()


class PatientTTSProvider(ABC):
    name: str

    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> TTSResult:
        raise NotImplementedError


class DisabledTTSProvider(PatientTTSProvider):
    name = "disabled"

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        raise TTSProviderError("Patient speech is disabled; the text response is still available.")


class KokoroTTSProvider(PatientTTSProvider):
    name = "kokoro"
    _male = ("am_adam", "am_michael")
    _female = ("af_heart", "af_bella")

    def __init__(self, settings: TTSSettings):
        self.settings = settings
        self.device = select_device(settings.device)
        self._pipeline: Any = None
        self._load_lock = threading.Lock()
        self._inference_lock = asyncio.Lock()

    def _load(self) -> Any:
        if self._pipeline is not None:
            return self._pipeline
        with self._load_lock:
            if self._pipeline is None:
                try:
                    if self.settings.model_cache_dir:
                        cache_path = Path(self.settings.model_cache_dir).expanduser()
                        if not cache_path.is_absolute():
                            cache_path = Path(__file__).resolve().parents[2] / cache_path
                        cache = str(cache_path.resolve())
                        os.environ["HF_HOME"] = cache
                        # The plain HTTP downloader is more reliable than the
                        # optional Xet transport on Windows/OneDrive paths.
                        os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
                        os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "120")
                    from kokoro import KPipeline
                    self._pipeline = KPipeline(lang_code="a", device=self.device)
                except Exception as exc:
                    raise TTSProviderError(
                        "Kokoro could not start. Install the local TTS requirements and espeak-ng, then restart the backend."
                    ) from exc
        return self._pipeline

    def _voice(self, request: TTSRequest) -> str:
        # Pediatric encounters deliberately use an adult parent voice.
        pool = self._female if request.gender.upper() == "F" else self._male
        return pool[_stable_hash(request.case_id) % len(pool)]

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        synthesized = normalize_for_speech(request.text)
        if not synthesized:
            raise TTSProviderError("There is no patient text to synthesize.")
        voice = self._voice(request)
        speed = request.speed if request.speed is not None else self.settings.speed
        async with self._inference_lock:
            def run() -> bytes:
                pipeline = self._load()
                chunks = [audio for _graphemes, _phonemes, audio in pipeline(synthesized, voice=voice, speed=speed)]
                if not chunks:
                    raise TTSProviderError("Kokoro returned no audio.")
                import numpy as np
                return _wav_bytes(np.concatenate(chunks), 24000)
            audio = await asyncio.to_thread(run)
        return TTSResult(audio, "audio/wav", 24000, self.name, voice, request.text, synthesized)


class ChatterboxTTSProvider(PatientTTSProvider):
    name = "chatterbox"

    def __init__(self, settings: TTSSettings):
        if not settings.enable_chatterbox:
            raise TTSConfigurationError("Chatterbox is disabled")
        self.settings = settings
        self.device = select_device(settings.device)
        self._model: Any = None
        self._load_lock = threading.Lock()
        self._inference_lock = asyncio.Lock()

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is None:
                try:
                    if self.settings.language == "ar":
                        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
                        self._model = ChatterboxMultilingualTTS.from_pretrained(device=self.device, t3_model="v3")
                    else:
                        from chatterbox.tts_turbo import ChatterboxTurboTTS
                        self._model = ChatterboxTurboTTS.from_pretrained(device=self.device, nano=True)
                except Exception as exc:
                    raise TTSProviderError("Chatterbox could not start. Install its optional requirements and restart the backend.") from exc
        return self._model

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        # User/model-provided tags are always stripped. Only the separate,
        # server-authored metadata field can add this deliberately tiny set.
        safe_expressions = {"cough"}
        tags = " ".join(f"[{tag}]" for tag in request.trusted_expressions if tag in safe_expressions)
        spoken = normalize_for_speech(re.sub(r"\[[^\]]*]", "", request.text)).strip()
        synthesized = f"{tags} {spoken}".strip()
        async with self._inference_lock:
            def run() -> tuple[bytes, int]:
                model = self._load()
                kwargs = {"language_id": "ar"} if self.settings.language == "ar" else {}
                wav = model.generate(synthesized, **kwargs)
                samples = wav.detach().cpu().numpy()
                return _wav_bytes(samples, int(model.sr)), int(model.sr)
            audio, sample_rate = await asyncio.to_thread(run)
        return TTSResult(audio, "audio/wav", sample_rate, self.name, "built-in", request.text, synthesized)


class TTSManager:
    def __init__(self, settings: TTSSettings):
        self.settings = settings
        self._provider: PatientTTSProvider | None = None
        self._fallback_provider: PatientTTSProvider | None = None
        self._lock = threading.Lock()

    def provider(self) -> PatientTTSProvider:
        if self._provider is not None:
            return self._provider
        with self._lock:
            if self._provider is None:
                if self.settings.provider == "kokoro":
                    self._provider = KokoroTTSProvider(self.settings)
                elif self.settings.provider == "chatterbox":
                    self._provider = ChatterboxTTSProvider(self.settings)
                else:
                    self._provider = DisabledTTSProvider()
        return self._provider

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        try:
            return await self.provider().synthesize(request)
        except TTSProviderError:
            if self.settings.fallback == "kokoro" and self.settings.provider != "kokoro":
                if self._fallback_provider is None:
                    with self._lock:
                        if self._fallback_provider is None:
                            self._fallback_provider = KokoroTTSProvider(self.settings)
                return await self._fallback_provider.synthesize(request)
            raise


_manager: TTSManager | None = None
_manager_lock = threading.Lock()


def get_tts_manager() -> TTSManager:
    global _manager
    if _manager is None:
        with _manager_lock:
            if _manager is None:
                _manager = TTSManager(load_tts_settings())
    return _manager

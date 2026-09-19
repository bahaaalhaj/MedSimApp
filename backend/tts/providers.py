from __future__ import annotations

import asyncio
import io
import os
import re
import threading
import wave
from abc import ABC, abstractmethod
from collections import OrderedDict
from dataclasses import dataclass, replace
from typing import Any

from .audio_cache import PersistentAudioCache
from .kokoro_cache import enable_verified_offline_cache, inspect_kokoro_cache, kokoro_cache_revision


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
    audio_cache_dir: str | None = None
    audio_cache_max_bytes: int = 512 * 1024 * 1024
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
    case_version: str = ""
    is_opening_greeting: bool = False
    cacheable: bool = False
    request_id: str = ""


@dataclass(frozen=True)
class TTSResult:
    audio: bytes
    media_type: str
    sample_rate: int
    provider: str
    voice: str
    transcript_text: str
    synthesized_text: str
    cache_hit: bool = False


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
    cache = values.get("PATIENT_TTS_MODEL_CACHE_DIR", "~/.cache/huggingface").strip() or "~/.cache/huggingface"
    audio_cache = values.get("PATIENT_TTS_AUDIO_CACHE_DIR", "~/.cache/medsim/tts").strip() or "~/.cache/medsim/tts"
    try:
        audio_cache_max_mb = int(values.get("PATIENT_TTS_AUDIO_CACHE_MAX_MB", "512"))
    except ValueError as exc:
        raise TTSConfigurationError("PATIENT_TTS_AUDIO_CACHE_MAX_MB must be an integer") from exc
    if not 64 <= audio_cache_max_mb <= 4096:
        raise TTSConfigurationError("PATIENT_TTS_AUDIO_CACHE_MAX_MB must be between 64 and 4096")
    return TTSSettings(
        provider=provider, device=device, fallback=fallback, model_cache_dir=cache,
        audio_cache_dir=audio_cache, audio_cache_max_bytes=audio_cache_max_mb * 1024 * 1024,
        enable_chatterbox=enabled, speed=speed, language=language,
    )


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
        # Device probing imports torch; defer it so persistent cache hits never
        # load Kokoro or PyTorch into an authentication/runtime process.
        self.device = "uninitialized"
        self._pipeline: Any = None
        self._load_lock = threading.Lock()
        self._inference_lock = asyncio.Lock()
        self.load_count = 0
        self.warm_up_count = 0

    def _load(self) -> Any:
        if self._pipeline is not None:
            return self._pipeline
        with self._load_lock:
            if self._pipeline is None:
                try:
                    enable_verified_offline_cache(self.settings.model_cache_dir)
                    self.device = select_device(self.settings.device)
                    from kokoro import KPipeline
                    self._pipeline = KPipeline(
                        lang_code="a", repo_id="hexgrad/Kokoro-82M", device=self.device,
                    )
                    self.load_count += 1
                except Exception as exc:
                    raise TTSProviderError(
                        f"Kokoro could not start: {exc}"
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
            # A disconnected browser may cancel its request while native CPU
            # inference is still running. Keep the provider lock until that
            # thread actually exits so a second Kokoro invocation cannot start
            # concurrently against the same resident pipeline.
            task = asyncio.create_task(asyncio.to_thread(run))
            try:
                audio = await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
        return TTSResult(audio, "audio/wav", 24000, self.name, voice, request.text, synthesized)

    async def warm_up(self) -> None:
        """Initialize model and kernels once; generated audio is discarded."""
        async with self._inference_lock:
            def run() -> None:
                pipeline = self._load()
                next(iter(pipeline("Ready.", voice="af_heart", speed=self.settings.speed)), None)
            await asyncio.to_thread(run)
            self.warm_up_count += 1


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
        self._preload_task: asyncio.Task[None] | None = None
        self._state = "deferred" if settings.provider == "kokoro" else "ready"
        self._error_category: str | None = None
        self._audio_cache: OrderedDict[tuple[str, str, str, float, str], TTSResult] = OrderedDict()
        self._audio_cache_limit = 64
        self._queue_slots = asyncio.Semaphore(4)
        self._synthesis_slot = asyncio.Lock()
        self._inflight: dict[tuple[str, str, str, float, str], asyncio.Task[TTSResult]] = {}
        self._latest_request_by_case: dict[str, str] = {}
        self._persistent_cache = PersistentAudioCache(settings.audio_cache_dir, settings.audio_cache_max_bytes)

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

    def preload_started(self) -> bool:
        return self._preload_task is not None

    def health(self) -> dict[str, object]:
        result: dict[str, object] = {
            "configured": True,
            "provider": self.settings.provider,
            "device": self.settings.device,
            "fallback": self.settings.fallback,
            "chatterbox_enabled": self.settings.enable_chatterbox,
        }
        if self.settings.provider == "kokoro" or self.settings.fallback == "kokoro":
            status = inspect_kokoro_cache(self.settings.model_cache_dir)
            result.update(status.public_dict())
            result["state"] = self._state if status.ready else "failed"
            result["error_category"] = self._error_category or (None if status.ready else status.state)
            result["audio_cache_entries"] = len(self._audio_cache)
            result["greeting_cache_entries"] = len(self._audio_cache)  # backward-compatible health field
            result["queue_capacity"] = 4
            provider = self._provider
            result["initialization_count"] = provider.load_count if isinstance(provider, KokoroTTSProvider) else 0
            result["warm_up_count"] = provider.warm_up_count if isinstance(provider, KokoroTTSProvider) else 0
            persistent = self._persistent_cache.stats()
            result["persistent_audio_cache_entries"] = persistent["entries"]
            result["persistent_audio_cache_bytes"] = persistent["bytes"]
            result["persistent_audio_cache_max_bytes"] = persistent["max_bytes"]
        else:
            result["state"] = "disabled" if self.settings.provider == "disabled" else "ready"
        return result

    def start_preload(self) -> asyncio.Task[None] | None:
        if self.settings.provider != "kokoro":
            return None
        if self._preload_task is not None:
            return self._preload_task
        cache = inspect_kokoro_cache(self.settings.model_cache_dir)
        if not cache.ready:
            self._state = "failed"
            self._error_category = cache.state
            return None
        self._state = "loading"
        self._preload_task = asyncio.create_task(self._preload_kokoro())
        return self._preload_task

    async def _preload_kokoro(self) -> None:
        try:
            provider = self.provider()
            if isinstance(provider, KokoroTTSProvider):
                await provider.warm_up()
            self._state = "ready"
            self._error_category = None
        except Exception:
            self._state = "failed"
            self._error_category = "tts-initialization-failed"

    def _cache_key(self, request: TTSRequest, provider: PatientTTSProvider) -> tuple[str, str, str, float, str] | None:
        if not (request.is_opening_greeting or request.cacheable) or not request.case_version or not isinstance(provider, KokoroTTSProvider):
            return None
        speed = request.speed if request.speed is not None else self.settings.speed
        revision = getattr(inspect_kokoro_cache(self.settings.model_cache_dir), "revision", None) or kokoro_cache_revision(self.settings.model_cache_dir) or "unknown"
        normalized = normalize_for_speech(request.text).casefold()
        return (request.case_version, normalized, provider._voice(request), round(speed, 3), revision)

    def _remember(self, key: tuple[str, str, str, float, str], result: TTSResult) -> None:
        self._audio_cache[key] = replace(result, cache_hit=False)
        self._audio_cache.move_to_end(key)
        while len(self._audio_cache) > self._audio_cache_limit:
            self._audio_cache.popitem(last=False)

    def _persistent_metadata(self, request: TTSRequest, provider: KokoroTTSProvider) -> dict[str, Any]:
        speed = request.speed if request.speed is not None else self.settings.speed
        return self._persistent_cache.metadata(
            case_version=request.case_version,
            normalized_text=normalize_for_speech(request.text).casefold(),
            voice=provider._voice(request), speed=speed,
            model_revision=kokoro_cache_revision(self.settings.model_cache_dir) or "unknown",
        )

    async def _synthesize_uncached(
        self,
        request: TTSRequest,
        provider: PatientTTSProvider,
        cache_key: tuple[str, str, str, float, str] | None,
    ) -> TTSResult:
        try:
            await asyncio.wait_for(self._queue_slots.acquire(), timeout=4.0)
        except TimeoutError as exc:
            raise TTSProviderError("Patient speech queue is busy; text remains available.") from exc
        try:
            try:
                await asyncio.wait_for(self._synthesis_slot.acquire(), timeout=4.0)
            except TimeoutError as exc:
                raise TTSProviderError("Patient speech synthesis is busy; text remains available.") from exc
            try:
                if request.request_id and self._latest_request_by_case.get(request.case_id) != request.request_id:
                    raise TTSProviderError("This speech request was superseded by a newer patient response.")
                result = await provider.synthesize(request)
                if isinstance(provider, KokoroTTSProvider):
                    self._state = "ready"
                    self._error_category = None
                if cache_key is not None:
                    self._remember(cache_key, result)
                    if isinstance(provider, KokoroTTSProvider):
                        try:
                            await asyncio.to_thread(self._persistent_cache.put, self._persistent_metadata(request, provider), result.audio)
                        except (OSError, ValueError):
                            # Persistent caching is optional; do not discard a
                            # successful live response if persistence fails.
                            pass
                return result
            finally:
                self._synthesis_slot.release()
        finally:
            self._queue_slots.release()

    async def synthesize(self, request: TTSRequest) -> TTSResult:
        provider = self.provider()
        if request.request_id:
            self._latest_request_by_case[request.case_id] = request.request_id
        cache_key = self._cache_key(request, provider)
        if cache_key is not None and cache_key in self._audio_cache:
            result = self._audio_cache.pop(cache_key)
            self._audio_cache[cache_key] = result
            return replace(result, cache_hit=True)
        if cache_key is not None and isinstance(provider, KokoroTTSProvider):
            metadata = self._persistent_metadata(request, provider)
            audio = await asyncio.to_thread(self._persistent_cache.get, metadata)
            if audio is not None:
                result = TTSResult(
                    audio, "audio/wav", 24000, "kokoro-persistent-cache", provider._voice(request),
                    request.text, normalize_for_speech(request.text), True,
                )
                self._remember(cache_key, result)
                return result
        try:
            if cache_key is None:
                return await self._synthesize_uncached(request, provider, None)
            task = self._inflight.get(cache_key)
            if task is None:
                task = asyncio.create_task(self._synthesize_uncached(request, provider, cache_key))
                self._inflight[cache_key] = task
                def clear_inflight(completed: asyncio.Task[TTSResult], key=cache_key) -> None:
                    if self._inflight.get(key) is completed:
                        self._inflight.pop(key, None)
                    if not completed.cancelled():
                        completed.exception()  # retrieve background failures after client cancellation
                task.add_done_callback(clear_inflight)
            return await asyncio.shield(task)
        except TTSProviderError:
            if self.settings.fallback == "kokoro" and self.settings.provider != "kokoro":
                if self._fallback_provider is None:
                    with self._lock:
                        if self._fallback_provider is None:
                            self._fallback_provider = KokoroTTSProvider(self.settings)
                return await self._fallback_provider.synthesize(request)
            raise

    async def prepare(self, requests: list[TTSRequest]) -> None:
        """Warm a strictly bounded, single-case set without delaying attempt creation."""
        for request in requests[:5]:
            try:
                await self.synthesize(replace(request, cacheable=True, request_id=""))
            except asyncio.CancelledError:
                raise
            except (TTSConfigurationError, TTSProviderError):
                return


_manager: TTSManager | None = None
_manager_lock = threading.Lock()


def get_tts_manager() -> TTSManager:
    global _manager
    if _manager is None:
        with _manager_lock:
            if _manager is None:
                _manager = TTSManager(load_tts_settings())
    return _manager

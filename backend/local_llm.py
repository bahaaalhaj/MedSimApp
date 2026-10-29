"""Provider-neutral LLM clients for hosted OpenRouter and optional llama.cpp.

Prompts, model configuration, and credentials remain server-side. Completion
requests try each approved model at most once; only the non-inference catalogue
health check uses bounded retries.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import ssl
import subprocess
import time
from contextlib import asynccontextmanager, contextmanager, nullcontext
from contextvars import ContextVar
from http.cookiejar import DefaultCookiePolicy
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator, Protocol
from urllib.parse import urlparse

import httpx


@dataclass(frozen=True)
class ChatRequest:
    system: str
    messages: list[dict[str, str]]
    max_tokens: int
    temperature: float = 0.2
    request_id: str = ""
    task: str = "patient-answer"


@dataclass(frozen=True)
class StructuredRequest:
    system: str
    user: str
    max_tokens: int
    temperature: float = 0.0
    request_id: str = ""


@dataclass(frozen=True)
class StructuredCompletion:
    value: dict[str, Any]
    actual_model: str | None
    request_id: str


@dataclass(frozen=True)
class ChatCompletion:
    text: str
    actual_model: str
    request_id: str
    reasoning_tokens: int
    attempted_models: tuple[str, ...]


@dataclass
class LLMHealth:
    provider: str
    model: str
    state: str
    base_url: str
    context_size: int
    max_concurrency: int
    gpu_offload: str
    detected_gpu: str | None
    model_file_bytes: int | None
    available_disk_bytes: int
    available_memory_bytes: int | None
    safety_status: str
    last_error_category: str | None
    catalog_context_length: int | None = None
    supports_structured_outputs: bool | None = None


class LLMProviderError(RuntimeError):
    def __init__(self, category: str, message: str, retryable: bool, status_code: int | None = None, actual_model: str | None = None):
        super().__init__(message)
        self.category = category
        self.safe_message = message
        self.retryable = retryable
        self.status_code = status_code
        self.actual_model = actual_model


class LocalLLMProvider(Protocol):
    async def health(self) -> LLMHealth: ...
    async def complete_chat(self, request: ChatRequest) -> ChatCompletion: ...
    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[str]: ...
    async def structured_completion(self, request: StructuredRequest, schema: dict[str, Any]) -> StructuredCompletion: ...


@dataclass(frozen=True)
class LocalLLMSettings:
    provider: str = "openrouter"
    base_url: str = "https://openrouter.ai/api/v1"
    patient_model: str = ""
    context_size: int = 4096
    max_concurrency: int = 1
    thinking: bool = False
    timeout_seconds: float = 7.0
    patient_timeout_seconds: float = 3.0
    hosted_semantic_timeout_seconds: float = 3.2
    gpu_offload: str = "not-applicable"
    model_path: str = ""
    evaluation_mode: str = "hybrid"
    api_key: str = ""
    fallback_models: tuple[str, ...] = ()
    enable_pro_fallback: bool = False
    max_retries: int = 1
    allow_paid_models: bool = False
    local_llm_enabled: bool = False
    local_interpretation_timeout_seconds: float = 12.0

    @classmethod
    def from_env(cls) -> "LocalLLMSettings":
        truthy = {"1", "true", "yes", "on"}
        provider = os.environ.get("MEDSIM_LLM_PROVIDER", "openrouter").strip().lower()
        local_enabled = os.environ.get("MEDSIM_LOCAL_LLM_ENABLED", "false").lower() in truthy
        if provider == "openrouter":
            settings = cls(
                provider=provider,
                base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/"),
                patient_model=os.environ.get("OPENROUTER_MODEL", "").strip(),
                timeout_seconds=float(os.environ.get("OPENROUTER_TIMEOUT_SECONDS", "7")),
                patient_timeout_seconds=float(os.environ.get("OPENROUTER_PATIENT_TIMEOUT_SECONDS", "3")),
                hosted_semantic_timeout_seconds=float(os.environ.get("OPENROUTER_SEMANTIC_TIMEOUT_SECONDS", "3.2")),
                api_key=os.environ.get("OPENROUTER_API_KEY", "").strip(),
                fallback_models=tuple(item.strip() for item in os.environ.get("OPENROUTER_FALLBACK_MODELS", "").split(",") if item.strip()),
                enable_pro_fallback=os.environ.get("OPENROUTER_PRO_FALLBACK_ENABLED", "false").lower() in truthy,
                max_retries=int(os.environ.get("OPENROUTER_MAX_RETRIES", "1")),
                allow_paid_models=os.environ.get("OPENROUTER_ALLOW_PAID_MODELS", "false").lower() in truthy,
                local_llm_enabled=local_enabled,
            )
        elif provider == "llama_cpp":
            settings = cls(
                provider=provider,
                base_url=os.environ.get("MEDSIM_LLM_BASE_URL", "http://127.0.0.1:8080/v1").rstrip("/"),
                patient_model=os.environ.get("MEDSIM_LLM_PATIENT_MODEL", "qwen3-local").strip(),
                context_size=int(os.environ.get("MEDSIM_LLM_CONTEXT_SIZE", "4096")),
                max_concurrency=int(os.environ.get("MEDSIM_LLM_MAX_CONCURRENCY", "1")),
                thinking=os.environ.get("MEDSIM_LLM_THINKING", "false").lower() in truthy,
                timeout_seconds=float(os.environ.get("MEDSIM_LLM_TIMEOUT_SECONDS", "60")),
                local_interpretation_timeout_seconds=float(os.environ.get("MEDSIM_LOCAL_INTERPRETATION_TIMEOUT_SECONDS", "12")),
                gpu_offload=os.environ.get("MEDSIM_LLM_GPU_OFFLOAD", "auto").strip(),
                model_path=os.environ.get("MEDSIM_LLM_MODEL_PATH", "").strip(),
                evaluation_mode=os.environ.get("MEDSIM_LLM_EVALUATION_MODE", "hybrid").strip(),
                local_llm_enabled=local_enabled,
            )
        else:
            raise ValueError("MEDSIM_LLM_PROVIDER must be openrouter or llama_cpp")
        settings.validate()
        return settings

    def validate(self) -> None:
        parsed = urlparse(self.base_url)
        if self.provider == "openrouter":
            if parsed.scheme != "https" or parsed.hostname != "openrouter.ai":
                raise ValueError("OPENROUTER_BASE_URL must be https://openrouter.ai/api/v1")
            if self.allow_paid_models:
                raise ValueError("Paid OpenRouter models are not permitted")
            candidates = ((self.patient_model,) if self.patient_model else ()) + self.fallback_models
            allowed = {"nex-agi/nex-n2.5-mini:free", "nex-agi/nex-n2.5-pro:free",
                       "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"}
            if any(item not in allowed for item in candidates):
                raise ValueError("OpenRouter models must be approved explicit free IDs")
            if len(self.fallback_models) > 1 or len(set(candidates)) != len(candidates):
                raise ValueError("Configure at most one distinct approved fallback model")
            if not 0 <= self.max_retries <= 4:
                raise ValueError("OPENROUTER_MAX_RETRIES must be between 0 and 4")
        elif parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("MEDSIM_LLM_BASE_URL must be loopback-only")
        if not 512 <= self.context_size <= 8192:
            raise ValueError("MEDSIM_LLM_CONTEXT_SIZE must be between 512 and 8192")
        if self.max_concurrency != 1:
            raise ValueError("MEDSIM_LLM_MAX_CONCURRENCY must be 1")
        if not 5 <= self.timeout_seconds <= 300:
            raise ValueError("LLM timeout must be between 5 and 300 seconds")
        if not 1 <= self.hosted_semantic_timeout_seconds <= 8:
            raise ValueError("OPENROUTER_SEMANTIC_TIMEOUT_SECONDS must be finite and between 1 and 8 seconds")
        if not 0.5 <= self.patient_timeout_seconds <= self.hosted_semantic_timeout_seconds - 0.2:
            raise ValueError("OPENROUTER_PATIENT_TIMEOUT_SECONDS must be at least 0.5 seconds and leave 0.2 seconds within the total semantic deadline")
        if not 1 <= self.local_interpretation_timeout_seconds <= 30:
            raise ValueError("MEDSIM_LOCAL_INTERPRETATION_TIMEOUT_SECONDS must be between 1 and 30 seconds")
        if self.evaluation_mode not in {"hybrid", "hybrid-local"}:
            raise ValueError("evaluation mode must be hybrid")


def _available_memory() -> int | None:
    if os.name != "nt":
        return None
    try:
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                        ("total_phys", ctypes.c_ulonglong), ("avail_phys", ctypes.c_ulonglong),
                        ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
                        ("total_virtual", ctypes.c_ulonglong), ("avail_virtual", ctypes.c_ulonglong),
                        ("avail_extended", ctypes.c_ulonglong)]
        status = MemoryStatus()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.avail_phys)
    except Exception:
        pass
    return None


@lru_cache(maxsize=1)
def _detected_gpu() -> str | None:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=3, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return result.stdout.strip().splitlines()[0] if result.returncode == 0 and result.stdout.strip() else None
    except Exception:
        return None


def _http_error(status: int) -> LLMProviderError:
    if status == 401:
        return LLMProviderError("configuration-invalid", "OpenRouter authentication failed. Check the server-side API key.", False, status)
    if status == 402:
        return LLMProviderError("free-capacity-unavailable", "OpenRouter could not serve this free-model request. No paid fallback was attempted.", True, status)
    if status == 408:
        return LLMProviderError("response-timeout", "The model response timed out. Retry the question.", True, status)
    if status == 429:
        return LLMProviderError("rate-limited", "The free-model rate limit was reached. Wait before retrying.", True, status)
    if status >= 500:
        return LLMProviderError("model-unavailable", "The hosted model is temporarily unavailable.", True, status)
    return LLMProviderError("model-unavailable", "The configured hosted model rejected the request.", False, status)


class _NoProviderCookies(DefaultCookiePolicy):
    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


class OpenRouterLLMProvider:
    def __init__(self, settings: LocalLLMSettings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self._transport = transport
        self._last_error_category: str | None = None
        self._ssl_context: ssl.SSLContext | None = None
        self._ssl_environment: tuple[str | None, str | None] | None = None
        self._pool_loop = None
        self._pooled_client = None
        self.tls_preparation_ms: float | None = None

    def _verified_ssl_context(self) -> ssl.SSLContext:
        # Keep HTTPX's existing CA/environment policy for both startup and
        # standalone clients. Failed replacements must not cache a new identity.
        environment = (os.environ.get("SSL_CERT_FILE"), os.environ.get("SSL_CERT_DIR"))
        context = self._ssl_context
        if context is None or environment != self._ssl_environment:
            context = httpx.create_ssl_context()
        if not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
            raise ValueError('Hosted HTTPS requires certificate and hostname verification')
        self._ssl_context, self._ssl_environment = context, environment
        return context

    def _client(self, timeout: float) -> httpx.AsyncClient:
        if self._transport is not None:
            client = httpx.AsyncClient(timeout=timeout, transport=self._transport)
            client.cookies.jar.set_policy(_NoProviderCookies())
            return client
        # Lifespan startup prepares trust without constructing a client. Calls
        # outside a lifespan retain lazy construction and environment detection.
        client = httpx.AsyncClient(timeout=timeout, verify=self._verified_ssl_context(),
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1, keepalive_expiry=30))
        client.cookies.jar.set_policy(_NoProviderCookies())
        return client

    @asynccontextmanager
    async def connection_lifespan(self):
        """Prepare local trust at startup; clients/connections remain lazy."""
        if self._pool_loop is not None:
            raise RuntimeError('Provider connection lifespan is already owned')
        self._pool_loop = asyncio.get_running_loop()
        try:
            self.tls_preparation_ms = None
            if self._transport is None:
                started = time.perf_counter()
                try:
                    self._verified_ssl_context()
                except Exception:
                    self._last_error_category = 'configuration-invalid'
                    # Certificate exceptions can contain private paths. Surface
                    # an explicit safe startup failure, never insecure fallback.
                    raise LLMProviderError('configuration-invalid',
                        'Hosted TLS trust preparation failed. Check the server certificate configuration.', False) from None
                finally:
                    self.tls_preparation_ms = round((time.perf_counter() - started) * 1000, 3)
            yield self
        finally:
            client, self._pooled_client = self._pooled_client, None
            try:
                if client is not None:
                    await client.aclose()
            finally:
                self._pool_loop = None

    @asynccontextmanager
    async def _request_client(self, timeout):
        if self._pool_loop is None:
            # Standalone calls and ASGI tests without lifespan retain a fresh,
            # promptly closed client. Never cache a client across asyncio.run().
            async with self._client(timeout) as client:
                yield client
        else:
            if self._pool_loop is not asyncio.get_running_loop():
                raise LLMProviderError('model-unavailable', 'Provider client belongs to a different event loop.', False)
            if self._pooled_client is None:
                self._pooled_client = self._client(timeout)
            yield self._pooled_client

    def _headers(self, request_id: str = "") -> dict[str, str]:
        headers = {"Authorization": f"Bearer {self.settings.api_key}", "Content-Type": "application/json", "X-Title": "MedSim"}
        if request_id:
            headers["X-Request-ID"] = request_id
        return headers

    async def _catalogue(self) -> list[dict[str, Any]]:
        for attempt in range(self.settings.max_retries + 1):
            try:
                timeout = min(self.settings.timeout_seconds, 15)
                # Readiness is not an inference operation. Keep its existing
                # short-lived client so a slow catalogue cannot occupy the
                # single completion connection while another student speaks.
                async with self._client(timeout) as client:
                    response = await client.get(f"{self.settings.base_url}/models", headers=self._headers(), timeout=timeout)
                if response.status_code >= 400:
                    error = _http_error(response.status_code)
                    if not error.retryable or attempt >= self.settings.max_retries:
                        raise error
                else:
                    data = response.json().get("data", [])
                    if not isinstance(data, list):
                        raise LLMProviderError("model-unavailable", "OpenRouter returned an invalid model catalogue.", True)
                    return [item for item in data if isinstance(item, dict)]
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt >= self.settings.max_retries:
                    raise LLMProviderError("model-unavailable", "OpenRouter could not be reached.", True) from exc
            await asyncio.sleep(min(0.25 * (2 ** attempt), 1.0))
        return []

    async def health(self) -> LLMHealth:
        state = "configuration-missing"
        context_length = None
        structured = None
        if not self.settings.patient_model:
            self._last_error_category = "missing-model"
        elif not self.settings.api_key:
            self._last_error_category = "missing-api-key"
        else:
            try:
                models = await self._catalogue()
                by_id = {str(entry.get("id")): entry for entry in models}
                candidates = self._candidates()
                item = by_id.get(self.settings.patient_model)
                selected = [by_id.get(model) for model in candidates]
                if item is None or any(entry is None for entry in selected):
                    state = "unavailable"
                    self._last_error_category = "model-unavailable"
                else:
                    is_free = all(
                        str(entry.get("pricing", {}).get("prompt", "")) == "0" and
                        str(entry.get("pricing", {}).get("completion", "")) == "0"
                        for entry in selected if entry is not None
                    )
                    supports_reasoning_control = all(
                        bool({"reasoning", "reasoning_effort"} & set(entry.get("supported_parameters", [])))
                        and not entry.get("reasoning", {}).get("mandatory", False)
                        for entry in selected if entry is not None
                    )
                    if not is_free:
                        state = "unavailable"
                        self._last_error_category = "paid-model-blocked"
                    elif not supports_reasoning_control:
                        state = "unavailable"
                        self._last_error_category = "unsupported-parameters"
                    else:
                        params = item.get("supported_parameters", [])
                        context_length = item.get("context_length") if isinstance(item.get("context_length"), int) else None
                        structured = "structured_outputs" in params
                        state = "ready"
                        self._last_error_category = None
            except LLMProviderError as exc:
                state = "unavailable"
                self._last_error_category = exc.category
            except Exception:
                state = "unavailable"
                self._last_error_category = "health-invalid-response"
        return LLMHealth(
            provider="openrouter", model=self.settings.patient_model, state=state,
            base_url=self.settings.base_url, context_size=self.settings.context_size,
            max_concurrency=1, gpu_offload="hosted", detected_gpu=None,
            model_file_bytes=None, available_disk_bytes=shutil.disk_usage(Path.cwd()).free,
            available_memory_bytes=_available_memory(), safety_status="hosted-no-local-model",
            last_error_category=self._last_error_category,
            catalog_context_length=context_length, supports_structured_outputs=structured,
        )

    def _candidates(self) -> tuple[str, ...]:
        # Exactly one explicitly selected model is called; legacy fallback
        # settings never produce a second model or automatic routing.
        return (self.settings.patient_model,) if self.settings.patient_model else ()

    def _base_payload(self, request: ChatRequest | StructuredRequest, model: str) -> dict[str, Any]:
        return {
            "model": model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "reasoning": {"effort": "none"},
            "provider": {"allow_fallbacks": False, "require_parameters": True,
                         "max_price": {"prompt": 0, "completion": 0, "request": 0}},
        }

    async def complete_chat(self, request: ChatRequest) -> ChatCompletion:
        attempted: list[str] = []
        last_error: LLMProviderError | None = None
        for model in self._candidates():
            attempted.append(model)
            payload = self._base_payload(request, model)
            payload.update({
                "messages": [{"role": "system", "content": request.system}, *request.messages],
                "stream": False,
                "max_tokens": min(request.max_tokens, 256 if request.task == "patient-interpretation" else 100),
            })
            try:
                # Patient dialogue has a separate, strict wall-clock budget.
                # Evaluator enrichment may use the longer general timeout, but
                # a learner must never wait that long for conversational text.
                patient_timeout = self.settings.patient_timeout_seconds
                async with asyncio.timeout(patient_timeout):
                    async with self._request_client(patient_timeout) as client:
                        response = await client.post(
                            f"{self.settings.base_url}/chat/completions",
                            headers=self._headers(request.request_id), json=payload, timeout=patient_timeout,
                        )
                if response.status_code >= 400:
                    raise _http_error(response.status_code)
                body = response.json()
                actual_model = str(body.get("model") or model)
                text = body["choices"][0]["message"]["content"]
                if not isinstance(text, str) or not text.strip():
                    raise LLMProviderError("model-unavailable", "The hosted model returned no patient text.", True, actual_model=actual_model)
                usage = body.get("usage", {}) if isinstance(body.get("usage"), dict) else {}
                details = usage.get("completion_tokens_details", {}) if isinstance(usage.get("completion_tokens_details"), dict) else {}
                reasoning_tokens = details.get("reasoning_tokens", usage.get("reasoning_tokens", 0))
                reasoning_tokens = int(reasoning_tokens) if isinstance(reasoning_tokens, (int, float)) else 0
                if reasoning_tokens > 0:
                    raise LLMProviderError("reasoning-not-disabled", "The hosted model did not honor disabled reasoning.", True, actual_model=actual_model)
                self._last_error_category = None
                return ChatCompletion(text, actual_model, request.request_id, reasoning_tokens, tuple(attempted))
            except LLMProviderError as exc:
                last_error = exc
            except (httpx.TimeoutException, TimeoutError):
                last_error = LLMProviderError("response-timeout", "The model response timed out.", True)
                # A patient turn has one absolute hosted wait budget. A timed-out
                # primary proceeds to deterministic text, never another model.
                break
            except httpx.TransportError:
                last_error = LLMProviderError("model-unavailable", "OpenRouter could not be reached.", True)
            except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
                last_error = LLMProviderError("model-unavailable", "The hosted model returned an invalid patient response.", True)
            if last_error and not last_error.retryable:
                break
        self._last_error_category = last_error.category if last_error else "model-unavailable"
        raise last_error or LLMProviderError("model-unavailable", "No approved hosted model is configured.", False)

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[str]:
        completion = await self.complete_chat(request)
        yield completion.text

    async def structured_completion(self, request: StructuredRequest, schema: dict[str, Any]) -> StructuredCompletion:
        last_error: LLMProviderError | None = None
        for model in self._candidates():
            payload = self._base_payload(request, model)
            payload.update({
                "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": request.user}],
                "stream": False,
                "response_format": {"type": "json_schema", "json_schema": {"name": "medsim_evaluation", "strict": True, "schema": schema}},
            })
            try:
                async with asyncio.timeout(self.settings.timeout_seconds):
                    async with self._request_client(self.settings.timeout_seconds) as client:
                        response = await client.post(f"{self.settings.base_url}/chat/completions", headers=self._headers(request.request_id), json=payload, timeout=self.settings.timeout_seconds)
                if response.status_code >= 400:
                    raise _http_error(response.status_code)
                body = response.json()
                actual_model = str(body.get("model") or model)
                try:
                    value = json.loads(body["choices"][0]["message"]["content"])
                except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
                    raise LLMProviderError(
                        "invalid-evaluator-schema", "The hosted evaluator returned invalid structured output.",
                        True, actual_model=actual_model,
                    ) from exc
                return StructuredCompletion(value=value, actual_model=actual_model, request_id=request.request_id)
            except LLMProviderError as exc:
                last_error = exc
            except (httpx.TimeoutException, TimeoutError):
                last_error = LLMProviderError("response-timeout", "The evaluator response timed out.", True)
            except httpx.TransportError:
                last_error = LLMProviderError("model-unavailable", "OpenRouter could not be reached.", True)
            except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
                last_error = LLMProviderError("invalid-evaluator-schema", "The hosted evaluator returned invalid structured output.", True)
            if last_error and not last_error.retryable:
                break
        raise last_error or LLMProviderError("model-unavailable", "No approved hosted evaluator is configured.", False)


class OpenAICompatibleLocalProvider:
    def __init__(self, settings: LocalLLMSettings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self._transport = transport
        self._last_error_category: str | None = None

    def _model_file_size(self) -> int | None:
        if not self.settings.model_path:
            return None
        try:
            return Path(self.settings.model_path).stat().st_size
        except OSError:
            return None

    async def health(self) -> LLMHealth:
        state = "unavailable"
        model = self.settings.patient_model
        try:
            async with httpx.AsyncClient(timeout=3.0, transport=self._transport, trust_env=False) as client:
                response = await client.get(f"{self.settings.base_url}/models")
                if response.status_code == 503:
                    state = "loading"
                    self._last_error_category = "model-starting"
                else:
                    response.raise_for_status()
                    data = response.json().get("data", [])
                    served = [str(item.get("id", "")) for item in data if isinstance(item, dict)]
                    if model in served:
                        state = "ready"
                        self._last_error_category = None
                    else:
                        self._last_error_category = "model-unavailable"
        except (httpx.ConnectError, httpx.NetworkError):
            self._last_error_category = "server-unavailable"
        except httpx.TimeoutException:
            state = "loading"
            self._last_error_category = "health-timeout"
        except Exception:
            self._last_error_category = "health-invalid-response"
        memory = _available_memory()
        model_bytes = self._model_file_size()
        safety = "safe"
        if memory is not None and memory < 2_500_000_000:
            safety = "unsafe-low-memory"
        elif memory is not None and memory < 3_200_000_000:
            safety = "constrained"
        if model_bytes and memory is not None and model_bytes > memory + 6 * 1024**3:
            safety = "unsafe-model-size"
        return LLMHealth(
            provider="llama_cpp", model=model, state=state, base_url=self.settings.base_url,
            context_size=self.settings.context_size, max_concurrency=1,
            gpu_offload=self.settings.gpu_offload, detected_gpu=_detected_gpu(),
            model_file_bytes=model_bytes, available_disk_bytes=shutil.disk_usage(Path.cwd()).free,
            available_memory_bytes=memory, safety_status=safety, last_error_category=self._last_error_category,
        )

    async def complete_chat(self, request: ChatRequest) -> ChatCompletion:
        payload = {
            "model": self.settings.patient_model,
            "messages": [{"role": "system", "content": request.system}, *request.messages],
            "max_tokens": min(request.max_tokens, 256 if request.task == "patient-interpretation" else 100), "temperature": request.temperature, "stream": False,
            "chat_template_kwargs": {"enable_thinking": self.settings.thinking},
        }
        timeout = self.settings.timeout_seconds
        if request.task == "patient-interpretation":
            from patient_interpretation import INTERPRETATION_SCHEMA
            payload["response_format"] = {"type": "json_schema", "json_schema": {
                "name": "patient_interpretation", "strict": True, "schema": INTERPRETATION_SCHEMA}}
            timeout = min(timeout, self.settings.local_interpretation_timeout_seconds)
        try:
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(5.0, timeout)), transport=self._transport, trust_env=False) as client:
                    response = await client.post(f"{self.settings.base_url}/chat/completions", json=payload)
                    response.raise_for_status()
                    body = response.json()
            text = body["choices"][0]["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty patient response")
            return ChatCompletion(text, str(body.get("model") or self.settings.patient_model), request.request_id, 0, (self.settings.patient_model,))
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise LLMProviderError("response-timeout", "The local model response timed out.", True) from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise LLMProviderError("model-unavailable", "The local model server is unavailable.", True) from exc

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[str]:
        completion = await self.complete_chat(request)
        yield completion.text

    async def structured_completion(self, request: StructuredRequest, schema: dict[str, Any]) -> StructuredCompletion:
        payload = {
            "model": self.settings.patient_model,
            "messages": [{"role": "system", "content": request.system}, {"role": "user", "content": request.user}],
            "max_tokens": request.max_tokens, "temperature": request.temperature, "stream": False,
            "chat_template_kwargs": {"enable_thinking": self.settings.thinking},
            "response_format": {"type": "json_schema", "json_schema": {"name": "medsim_evaluation", "strict": True, "schema": schema}},
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.settings.timeout_seconds, connect=5.0), transport=self._transport, trust_env=False) as client:
                response = await client.post(f"{self.settings.base_url}/chat/completions", json=payload)
                response.raise_for_status()
                body = response.json()
            return StructuredCompletion(
                value=json.loads(body["choices"][0]["message"]["content"]),
                actual_model=str(body.get("model")) if body.get("model") else self.settings.patient_model,
                request_id=request.request_id,
            )
        except httpx.TimeoutException as exc:
            raise LLMProviderError("response-timeout", "The local evaluator timed out.", True) from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise LLMProviderError("invalid-evaluator-schema", "The local evaluator returned invalid structured output.", False) from exc


class DisabledLocalProvider:
    def __init__(self, settings: LocalLLMSettings):
        self.settings = settings

    async def health(self) -> LLMHealth:
        return LLMHealth(
            provider="llama_cpp", model=self.settings.patient_model, state="disabled", base_url=self.settings.base_url,
            context_size=self.settings.context_size, max_concurrency=1, gpu_offload=self.settings.gpu_offload,
            detected_gpu=None, model_file_bytes=None, available_disk_bytes=shutil.disk_usage(Path.cwd()).free,
            available_memory_bytes=_available_memory(), safety_status="local-provider-disabled",
            last_error_category="local-provider-disabled",
        )

    async def complete_chat(self, request: ChatRequest) -> ChatCompletion:
        raise LLMProviderError("local-provider-disabled", "The optional offline model is disabled.", False)

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[str]:
        raise LLMProviderError("local-provider-disabled", "The optional offline model is disabled.", False)
        yield ""  # pragma: no cover

    async def structured_completion(self, request: StructuredRequest, schema: dict[str, Any]) -> StructuredCompletion:
        raise LLMProviderError("local-provider-disabled", "The optional offline model is disabled.", False)


class SerializingLocalLLMProvider:
    """One inference gate shared by patient/evaluator calls in its owning loop."""
    def __init__(self, delegate: LocalLLMProvider):
        self.delegate = delegate
        self._gate = asyncio.Semaphore(1)
        self._gate_loop = None
        self._calls = set()
        self._owner_loop = None
        self._closing = False

    @asynccontextmanager
    async def lifespan(self):
        if self._owner_loop is not None or self._calls:
            raise RuntimeError('Provider lifecycle is already in use')
        self._owner_loop = asyncio.get_running_loop()
        self._gate = asyncio.Semaphore(1)
        self._gate_loop = self._owner_loop
        self._closing = False
        manager = self.delegate.connection_lifespan() if isinstance(self.delegate, OpenRouterLLMProvider) else nullcontext()
        try:
            async with manager:
                try:
                    yield self
                finally:
                    # Includes callers waiting for the inference gate. Shutdown
                    # cancels them before closing the owning loop's HTTP client.
                    self._closing = True
                    calls = list(self._calls - {asyncio.current_task()})
                    for task in calls:
                        task.cancel()
                    if calls:
                        await asyncio.gather(*calls, return_exceptions=True)
        finally:
            # Also fail closed if the delegate could not enter its lifespan.
            self._closing = True
            self._owner_loop = None

    @asynccontextmanager
    async def _operation(self):
        loop = asyncio.get_running_loop()
        if self._closing or (self._owner_loop is not None and self._owner_loop is not loop):
            raise LLMProviderError('model-unavailable', 'Provider lifecycle is closed or belongs to another event loop.', True)
        if self._gate_loop is None:
            # The standalone diagnostic may already hold this gate before the
            # first call. Preserve that lock and its queue on initial binding.
            self._gate_loop = loop
        elif self._gate_loop is not loop:
            if self._calls:
                raise LLMProviderError('model-unavailable', 'Concurrent event loops require separate provider lifecycles.', True)
            self._gate = asyncio.Semaphore(1)
            self._gate_loop = loop
        task = asyncio.current_task()
        self._calls.add(task)
        try:
            yield
        finally:
            self._calls.discard(task)

    async def health(self) -> LLMHealth:
        async with self._operation():
            return await self.delegate.health()

    async def complete_chat(self, request: ChatRequest) -> ChatCompletion:
        async with self._operation(), self._gate:
            return await self.delegate.complete_chat(request)

    async def stream_chat(self, request: ChatRequest) -> AsyncIterator[str]:
        async with self._operation(), self._gate:
            async for token in self.delegate.stream_chat(request):
                yield token

    async def structured_completion(self, request: StructuredRequest, schema: dict[str, Any]) -> StructuredCompletion:
        async with self._operation(), self._gate:
            return await self.delegate.structured_completion(request, schema)


def build_provider(configured: LocalLLMSettings) -> LocalLLMProvider:
    if configured.provider == "openrouter":
        return OpenRouterLLMProvider(configured)
    if configured.local_llm_enabled:
        return OpenAICompatibleLocalProvider(configured)
    return DisabledLocalProvider(configured)


_settings = LocalLLMSettings.from_env()
_provider: LocalLLMProvider = SerializingLocalLLMProvider(build_provider(_settings))
_application_provider = ContextVar('medsim_application_provider', default=None)


def new_application_provider():
    """A new gate/client owner per application lifecycle; no eager networking."""
    delegate = _provider.delegate
    if isinstance(delegate, (OpenRouterLLMProvider, OpenAICompatibleLocalProvider)):
        if delegate._transport is not None:
            raise RuntimeError('Injected transports require an explicit per-application provider factory')
        delegate = type(delegate)(delegate.settings)
    return SerializingLocalLLMProvider(delegate)


@contextmanager
def bind_application_provider(provider):
    token = _application_provider.set(provider)
    try:
        yield
    finally:
        _application_provider.reset(token)


def get_local_llm_provider() -> LocalLLMProvider:
    return _application_provider.get() or _provider


def set_local_llm_provider_for_tests(provider: LocalLLMProvider) -> None:
    global _provider
    _provider = SerializingLocalLLMProvider(provider)


def settings() -> LocalLLMSettings:
    return _settings


def health_dict(health: LLMHealth) -> dict[str, Any]:
    result = asdict(health)
    if health.provider == "openrouter":
        result["base_url"] = "hosted"
    return result

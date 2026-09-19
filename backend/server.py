"""
FastAPI backend for the MedSim simulator.

Hosts local-LLM patient dialogue and hybrid evaluation endpoints, account
services, investigation attempts, and local patient text-to-speech.

GET  /health         â†’ backend + agent status report
POST /agent/patient/stream â†’ local patient SSE
POST /tts/synthesize â†’ synthesize patient speech locally
"""

from __future__ import annotations

import os
import asyncio
import logging
import json
import threading
import copy
import hashlib
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, Literal, Optional


def _load_env_local() -> None:
    """Minimal .env.local loader â€” no python-dotenv dependency.

    Reads `backend/.env.local` (next to this file) and sets any KEY=VALUE
    pair into ``os.environ`` without overwriting values already set.
    Silently no-ops if the file is missing."""
    env_path = Path(__file__).resolve().parent / ".env.local"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Overwrite if the existing value is empty (subprocesses can inherit
        # declared-but-empty env vars from the parent). Only preserve a
        # non-empty existing value.
        if key and not os.environ.get(key):
            os.environ[key] = value


_load_env_local()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from auth_system import AuthApi, AuthSettings, build_auth_router
from tts import TTSConfigurationError, TTSProviderError, TTSRequest, get_tts_manager, load_tts_settings
from local_ai import (
    EVALUATION_SCHEMA, LOCAL_AI_CASES, SAFE_UNKNOWN_RESPONSE,
    compose_patient_answer, deterministic_patient_match, evaluation_prompt, exact_patient_answer,
    normalize_evaluation, opening_greeting, patient_system_prompt,
    public_profile, sanitize_patient_response, validate_model_evaluation,
)
from local_llm import (
    ChatRequest, LLMProviderError, StructuredRequest,
    get_local_llm_provider, health_dict, settings as llm_settings,
)

# Validate cheap configuration at import/startup without loading model weights.
TTS_SETTINGS = load_tts_settings()

# Shared secret protects /agent/*, /tts/*, and /api/* against direct curl abuse.
# Vercel Edge Middleware injects this header for browser traffic; a
# missing/wrong value returns 401 before we burn any model resources
# credits. Localhost origins bypass for `npm run dev`.
SHARED_SECRET = os.environ.get("BACKEND_SHARED_SECRET", "")
ALLOWED_ORIGINS = [
    "https://medsim.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
DEV_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
}

# Per-IP rate limit caps even authenticated abuse. SSE streams count as one
# request, so 120/min leaves plenty of headroom for legitimate use.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Authentication and initial rendering must not compete with torch/Kokoro.
    # Model loading is deferred until a patient attempt is selected.
    yield


app = FastAPI(title="MedSim Backend", version="0.2.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Middleware ORDER (inside-out â€” last added runs first on inbound):
#   1. Auth          (innermost, added first)
#   2. SlowAPI       (rate limit)
#   3. CORS          (outermost, handles OPTIONS preflight before auth)
@app.middleware("http")
async def require_shared_secret(request: Request, call_next):
    path = request.url.path
    # /health is public for monitoring; CORS preflight runs above this anyway
    # but bypass OPTIONS defensively.
    if path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    origin = request.headers.get("origin", "")
    if origin in DEV_ORIGINS:
        return await call_next(request)
    # Same-origin GETs (incl. EventSource) don't send Origin per the Fetch
    # spec, but they DO send Referer. Trust dev-origin Referer in lieu of
    # Origin so SSE streams from localhost work without an explicit secret.
    referer = request.headers.get("referer", "")
    if any(referer.startswith(o + "/") for o in DEV_ORIGINS):
        return await call_next(request)
    if SHARED_SECRET and request.headers.get("x-medsim-auth") == SHARED_SECRET:
        return await call_next(request)
    return JSONResponse({"detail": "unauthorized"}, status_code=401)


app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

auth_api = AuthApi(AuthSettings.from_env())
app.include_router(build_auth_router(auth_api, limiter))

# Browser-safe case catalogue. Ground-truth diagnosis, rubric, expected
# medicines, and unrequested results are deliberately absent. The current SPA
# still has legacy in-bundle case data for compatibility; moving all encounter
# truth behind server-owned attempt APIs is tracked in the governance docs.
_CURATION_MANIFEST_PATH = Path(__file__).resolve().parents[1] / "docs" / "generated" / "curation-manifest.json"
_INVESTIGATION_MANIFEST_PATH = Path(__file__).resolve().parents[1] / "docs" / "generated" / "investigation-manifest.server.json"


def _load_safe_curated_cases():
    try:
        payload = json.loads(_CURATION_MANIFEST_PATH.read_text(encoding="utf-8"))
        cases = payload.get("safeCases", [])
        if payload.get("counts", {}).get("curated") != 72 or len(cases) != 72:
            raise ValueError("curation manifest must contain exactly 72 cases")
        return cases
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing curation manifest: {exc}") from exc


_SAFE_CURATED_CASES = _load_safe_curated_cases()


def _load_investigation_cases() -> dict[str, dict[str, Any]]:
    try:
        payload = json.loads(_INVESTIGATION_MANIFEST_PATH.read_text(encoding="utf-8"))
        cases = payload.get("cases", [])
        if len(cases) != 72:
            raise ValueError("investigation manifest must contain exactly 72 cases")
        return {item["caseId"]: item for item in cases}
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing investigation manifest: {exc}") from exc


_INVESTIGATION_CASES = _load_investigation_cases()
_INVESTIGATION_ATTEMPTS: dict[str, dict[str, Any]] = {}
_INVESTIGATION_LOCK = threading.Lock()
_ATTEMPT_TTL_SECONDS = 6 * 60 * 60
_MAX_ACTIVE_ATTEMPTS_PER_OWNER = 32


def _attempt_owner(request: Request) -> str:
    user = auth_api.service.current_user(request.cookies.get(auth_api.SESSION_COOKIE))
    if user:
        return f"user:{user['id']}"
    # Guest attempts are bound to the browser/network fingerprint as a second
    # layer in addition to the 256-bit opaque attempt id. No clinical truth is
    # encoded in either identifier.
    raw = f"{request.client.host if request.client else ''}|{request.headers.get('user-agent', '')}"
    return "guest:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_attempt(request: Request, attempt_id: str) -> dict[str, Any]:
    attempt = _INVESTIGATION_ATTEMPTS.get(attempt_id)
    if not attempt or attempt["expiresAt"] <= time.time() or attempt["owner"] != _attempt_owner(request):
        raise HTTPException(status_code=404, detail="attempt not found")
    return attempt


def _clean_attempts(now: float, owner: str) -> None:
    expired = [key for key, value in _INVESTIGATION_ATTEMPTS.items() if value["expiresAt"] <= now]
    for key in expired:
        _INVESTIGATION_ATTEMPTS.pop(key, None)
    owned = sorted(
        ((key, value) for key, value in _INVESTIGATION_ATTEMPTS.items() if value["owner"] == owner),
        key=lambda pair: pair[1]["createdAt"],
    )
    for key, _ in owned[:-(_MAX_ACTIVE_ATTEMPTS_PER_OWNER - 1)]:
        _INVESTIGATION_ATTEMPTS.pop(key, None)


class PublicPatientProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=0, le=120)
    chiefComplaint: str = Field(min_length=1, max_length=500)


class CreateClinicalAttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caseId: str
    caseVersion: str
    variantSeed: str = Field(default="", max_length=200)
    clientAttemptId: str | None = Field(default=None, min_length=12, max_length=200)
    patientProfile: PublicPatientProfile | None = None


class InvestigationOrderRequest(BaseModel):
    investigationId: str
    indication: str = ""


def _safe_investigation(investigation: dict[str, Any]) -> dict[str, Any]:
    allowed = ("testId", "name", "category", "role", "availability", "reason", "turnaroundSec", "prerequisite")
    return {key: investigation[key] for key in allowed if key in investigation}


def _public_order(order: dict[str, Any], include_result: bool) -> dict[str, Any]:
    if order["status"] == "pending" and order["availableAt"] <= time.time():
        order["status"] = "available"
    result = {
        "orderId": order["orderId"], "investigationId": order["investigationId"],
        "orderedAt": order["orderedAt"], "availableAt": order["availableAt"], "status": order["status"],
        "indication": order["indication"], "statusDetail": order.get("statusDetail"),
    }
    if include_result and order["status"] == "available":
        result["resultSnapshot"] = copy.deepcopy(order["resultSnapshot"])
    return result


async def _prepare_case_audio(local_ai_case: dict[str, Any], profile: dict[str, Any]) -> None:
    """Prepare only the selected case greeting and four likely authored turns."""
    if TTS_SETTINGS.provider != "kokoro":
        return
    case_id = local_ai_case["caseId"]
    case_version = local_ai_case["caseVersion"]
    gender = str(profile.get("gender", "F"))
    is_parent = int(profile.get("age", 18)) < 14
    requests = [TTSRequest(
        text=opening_greeting(profile), case_id=case_id, case_version=case_version,
        gender=gender, is_pediatric=is_parent, is_opening_greeting=True, cacheable=True,
    ), TTSRequest(
        text=SAFE_UNKNOWN_RESPONSE, case_id=case_id, case_version=case_version,
        gender=gender, is_pediatric=is_parent, cacheable=True,
    )]
    for item in local_ai_case["patient"].get("history", [])[:3]:
        requests.append(TTSRequest(
            text=compose_patient_answer(item["answer"], item["question"], is_parent=is_parent),
            case_id=case_id, case_version=case_version, gender=gender,
            is_pediatric=is_parent, cacheable=True,
        ))
    manager = get_tts_manager()
    await manager.prepare(requests)


_TTS_PREPARE_TASKS: set[asyncio.Task[None]] = set()


def _schedule_case_audio(local_ai_case: dict[str, Any], profile: dict[str, Any]) -> None:
    task = asyncio.create_task(_prepare_case_audio(local_ai_case, profile))
    _TTS_PREPARE_TASKS.add(task)
    task.add_done_callback(_TTS_PREPARE_TASKS.discard)


@app.post("/api/attempts", status_code=201)
async def create_clinical_attempt(payload: CreateClinicalAttemptRequest, request: Request):
    clinical_case = _INVESTIGATION_CASES.get(payload.caseId)
    if not clinical_case or clinical_case["caseVersion"] != payload.caseVersion:
        raise HTTPException(status_code=404, detail="assignable case/version not found")
    local_ai_case = LOCAL_AI_CASES.get(payload.caseId)
    if not local_ai_case or local_ai_case["caseVersion"] != payload.caseVersion:
        raise HTTPException(status_code=404, detail="local AI case/version not found")
    try:
        profile = public_profile(local_ai_case, payload.patientProfile.model_dump() if payload.patientProfile else None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    owner = _attempt_owner(request)
    now = time.time()
    with _INVESTIGATION_LOCK:
        _clean_attempts(now, owner)
        existing = next((item for item in _INVESTIGATION_ATTEMPTS.values() if payload.clientAttemptId and
            item["owner"] == owner and item["caseId"] == payload.caseId and
            item["caseVersion"] == payload.caseVersion and item.get("clientAttemptId") == payload.clientAttemptId), None)
        if existing:
            return {
                "attemptId": existing["attemptId"], "caseId": payload.caseId,
                "caseVersion": payload.caseVersion,
                "investigations": [_safe_investigation(item) for item in clinical_case["investigations"]],
                "openingGreeting": opening_greeting(existing["patientProfile"]),
            }
        attempt_id = secrets.token_urlsafe(32)
        attempt = {
            "attemptId": attempt_id, "owner": owner, "caseId": payload.caseId,
            "caseVersion": payload.caseVersion, "createdAt": now,
            "expiresAt": now + _ATTEMPT_TTL_SECONDS, "orders": {}, "orderByInvestigation": {},
            "localAiCase": local_ai_case, "patientProfile": profile,
            "patientMessages": [], "askedQuestionIds": [], "variantSeed": payload.variantSeed,
            "clientAttemptId": payload.clientAttemptId,
            "patientRequestActive": False, "patientResponses": {},
            "evaluationActive": False, "evaluationResult": None,
        }
        _INVESTIGATION_ATTEMPTS[attempt_id] = attempt
    return {
        "attemptId": attempt_id, "caseId": payload.caseId, "caseVersion": payload.caseVersion,
        "investigations": [_safe_investigation(item) for item in clinical_case["investigations"]],
        "openingGreeting": opening_greeting(profile),
    }


@app.post("/api/attempts/{attempt_id}/investigations/orders", status_code=201)
def order_investigation(attempt_id: str, payload: InvestigationOrderRequest, request: Request):
    with _INVESTIGATION_LOCK:
        attempt = _get_attempt(request, attempt_id)
        existing_id = attempt["orderByInvestigation"].get(payload.investigationId)
        if existing_id:
            return _public_order(attempt["orders"][existing_id], include_result=False)
        clinical_case = _INVESTIGATION_CASES.get(attempt["caseId"])
        if not clinical_case or clinical_case["caseVersion"] != attempt["caseVersion"]:
            raise HTTPException(status_code=409, detail="assigned case version is no longer available")
        investigation = next((item for item in clinical_case["investigations"] if item["testId"] == payload.investigationId), None)
        if not investigation:
            raise HTTPException(status_code=404, detail="investigation is not available for this case")
        now = time.time()
        order_id = secrets.token_urlsafe(24)
        orderable = investigation["availability"] in {"available-if-ordered", "result-available"} or (
            investigation["availability"] == "conditional" and bool(payload.indication.strip()) and investigation.get("structuredResult") is not None
        )
        status = "pending" if orderable else "unavailable"
        result_snapshot = {
            "investigationId": investigation["testId"], "name": investigation["name"],
            "category": investigation["category"], "structuredResult": investigation.get("structuredResult"),
            "resultText": investigation.get("result", ""), "abnormal": investigation.get("abnormal"),
            "verificationStatus": investigation.get("verificationStatus"), "scoreable": investigation.get("scoreable", False),
        } if orderable else None
        order = {
            "orderId": order_id, "investigationId": payload.investigationId, "indication": payload.indication[:500],
            "orderedAt": now, "availableAt": now + min(2.0, max(0.05, float(investigation.get("turnaroundSec", 30)) / 100.0)) if orderable else now, "status": status,
            "resultSnapshot": copy.deepcopy(result_snapshot),
            "releasedAt": None,
            "statusDetail": None if orderable else (
                "A documented indication is required before this conditional investigation can return a result."
                if investigation["availability"] == "conditional"
                else "This investigation is not indicated or is not modeled for this case version; no result was generated."
            ),
        }
        attempt["orders"][order_id] = order
        attempt["orderByInvestigation"][payload.investigationId] = order_id
        return _public_order(order, include_result=False)


@app.get("/api/attempts/{attempt_id}/investigations")
def list_investigation_orders(attempt_id: str, request: Request):
    with _INVESTIGATION_LOCK:
        attempt = _get_attempt(request, attempt_id)
        return [_public_order(order, include_result=False) for order in attempt["orders"].values()]


@app.get("/api/attempts/{attempt_id}/investigations/{order_id}")
def get_investigation_result(attempt_id: str, order_id: str, request: Request):
    with _INVESTIGATION_LOCK:
        attempt = _get_attempt(request, attempt_id)
        order = attempt["orders"].get(order_id)
        if not order:
            raise HTTPException(status_code=404, detail="investigation order not found")
        result = _public_order(order, include_result=True)
        if order["status"] == "available" and result.get("resultSnapshot") is not None and order.get("releasedAt") is None:
            order["releasedAt"] = time.time()
        return result


def _development_cases_enabled() -> bool:
    return os.environ.get("MEDSIM_ENABLE_DEVELOPMENT_CASES", "").lower() in {"1", "true", "yes"}


@app.get("/api/clinical/cases")
def list_safe_cases(mode: str = "curated"):
    del mode
    return _SAFE_CURATED_CASES


@app.get("/api/clinical/cases/{case_id}")
def get_safe_case(case_id: str, mode: str = "curated"):
    eligible = list_safe_cases(mode)
    case = next((item for item in eligible if item["caseId"] == case_id), None)
    if not case:
        raise HTTPException(status_code=404, detail="case not available in this training mode")
    return case


class PatientTurnRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: str = Field(min_length=20, max_length=100)
    question: str = Field(min_length=1, max_length=500)
    source: Literal["typed", "predefined"]
    questionId: str | None = Field(default=None, max_length=120)
    requestId: str | None = Field(default=None, min_length=12, max_length=100)


class TranscriptEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["trainee", "patient"]
    content: str = Field(max_length=2000)
    timestampIso: str = Field(max_length=80)
    questionSource: Literal["typed", "predefined"] | None = None
    attemptId: str = Field(min_length=20, max_length=100)


class ExaminationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actionId: str = Field(min_length=1, max_length=120)
    performedAt: float
    attemptId: str = Field(min_length=20, max_length=100)


class PrescriptionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    medicationId: str = Field(max_length=120)
    dose: str = Field(max_length=120)
    duration: str = Field(max_length=120)


class CompletionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summaryCompleted: bool = False
    safetyNettingCompleted: bool = False
    ideasConcernsExpectationsCompleted: bool = False


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attemptId: str = Field(min_length=20, max_length=100)
    caseId: str = Field(max_length=120)
    caseVersion: str = Field(max_length=120)
    variantSeed: str = Field(default="", max_length=200)
    askedQuestionIds: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=128)
    treatmentIds: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=128)
    prescriptions: list[PrescriptionEvidence] = Field(default_factory=list, max_length=64)
    submittedDiagnosisId: str | None = Field(default=None, max_length=120)
    transcript: list[TranscriptEvidence] = Field(default_factory=list, max_length=256)
    examinations: list[ExaminationEvidence] = Field(default_factory=list, max_length=64)
    completionChecks: CompletionEvidence | None = None


def _sse(value: dict[str, Any]) -> str:
    return "data: " + json.dumps(value, separators=(",", ":")) + "\n\n"


def _safe_error_category(exc: Exception) -> tuple[str, str, bool]:
    if isinstance(exc, LLMProviderError):
        return exc.category, exc.safe_message, exc.retryable
    if isinstance(exc, TimeoutError):
        return "response-timeout", "The configured model timed out. Retry the question.", True
    return "model-unavailable", "The configured model is unavailable. Retry later.", True


@app.post("/agent/patient/stream")
async def patient_stream(req: PatientTurnRequest, request: Request):
    correlation_id = req.requestId or secrets.token_urlsafe(12)
    with _INVESTIGATION_LOCK:
        attempt = _get_attempt(request, req.attemptId)
        cached = attempt["patientResponses"].get(correlation_id)
        if cached is not None:
            cached_record = cached if isinstance(cached, dict) else {"text": str(cached), "provenance": "deterministic-authored", "actualModel": None}
            async def cached_generator():
                text = cached_record["text"]
                for offset in range(0, len(text), 32):
                    yield _sse({"text": text[offset:offset + 32], "correlationId": correlation_id})
                yield _sse({
                    "done": True, "correlationId": correlation_id,
                    "provenance": cached_record.get("provenance"),
                    "actualModel": cached_record.get("actualModel"),
                    "matchConfidence": cached_record.get("matchConfidence", 0.0),
                    "intentId": cached_record.get("intentId"),
                    "matchedSource": cached_record.get("matchedSource"),
                })
            return StreamingResponse(cached_generator(), media_type="text/event-stream")
        case = attempt["localAiCase"]
        profile = copy.deepcopy(attempt["patientProfile"])
        history = copy.deepcopy(attempt["patientMessages"][-8:])
        authored_value: str | None = None
        matched_question_id: str | None = None
        match_confidence = 0.0
        deterministic_fallback = deterministic_patient_match(
            case, req.question, is_parent=profile["age"] < 14, profile=profile,
        )
        answer_provenance = "deterministic-authored"
        if req.source == "predefined":
            authored_value = exact_patient_answer(case, req.questionId)
            if authored_value is None:
                raise HTTPException(status_code=422, detail="unknown predefined question")
            answer = compose_patient_answer(authored_value, req.question, is_parent=profile["age"] < 14)
            matched_question_id = req.questionId
            match_confidence = 1.0
        elif req.questionId is not None:
            raise HTTPException(status_code=422, detail="typed questions cannot supply a question ID")
        else:
            immediate = deterministic_fallback.provenance == "deterministic-authored" or deterministic_fallback.confidence == 1.0
            answer = deterministic_fallback.response if immediate else None
            if immediate:
                answer_provenance = deterministic_fallback.provenance
                authored_value = deterministic_fallback.authored_value
                matched_question_id = deterministic_fallback.matched_question_id
                match_confidence = deterministic_fallback.confidence
        if attempt["patientRequestActive"]:
            raise HTTPException(status_code=409, detail="A patient response is already in progress for this encounter.")
        attempt["patientRequestActive"] = True

    async def generator():
        response_text = ""
        provenance = answer_provenance
        actual_model: str | None = None
        attempted_models: list[str] = []
        provider_error_category: str | None = None
        record_authored_value = authored_value
        record_matched_question_id = matched_question_id
        record_match_confidence = match_confidence
        record_intent_id = deterministic_fallback.intent_id
        record_matched_source = deterministic_fallback.matched_source
        try:
            if answer is not None:
                response_text = answer
            else:
                provider = get_local_llm_provider()
                messages = [*history, {"role": "user", "content": req.question.strip()}]
                try:
                    completion = await provider.complete_chat(ChatRequest(
                        system=patient_system_prompt(case, profile),
                        messages=messages,
                        max_tokens=80,
                        temperature=0.1,
                        request_id=correlation_id,
                    ))
                    attempted_models = list(completion.attempted_models)
                    actual_model = completion.actual_model
                    response_text = sanitize_patient_response(completion.text, case)
                    provenance = "safe-unknown" if response_text == SAFE_UNKNOWN_RESPONSE else "openrouter"
                except Exception as exc:
                    provider_error_category, _message, _retryable = _safe_error_category(exc)
                    response_text = deterministic_fallback.response
                    provenance = deterministic_fallback.provenance
                    record_authored_value = deterministic_fallback.authored_value
                    record_matched_question_id = deterministic_fallback.matched_question_id
                    record_match_confidence = deterministic_fallback.confidence
            with _INVESTIGATION_LOCK:
                current = _get_attempt(request, req.attemptId)
                current["patientMessages"] = [
                    *current["patientMessages"],
                    {"role": "user", "content": req.question.strip()},
                    {"role": "assistant", "content": response_text},
                ][-16:]
                current["patientResponses"][correlation_id] = {
                    "text": response_text, "provenance": provenance,
                    "actualModel": actual_model, "attemptedModels": attempted_models,
                    "providerErrorCategory": provider_error_category,
                    "matchConfidence": record_match_confidence,
                    "matchedQuestionId": record_matched_question_id,
                    "authoredValue": record_authored_value,
                    "intentId": record_intent_id,
                    "matchedSource": record_matched_source,
                }
                if len(current["patientResponses"]) > 16:
                    current["patientResponses"].pop(next(iter(current["patientResponses"])))
                recorded_question_id = req.questionId or record_matched_question_id
                if recorded_question_id and recorded_question_id not in current["askedQuestionIds"]:
                    current["askedQuestionIds"].append(recorded_question_id)
                if os.environ.get("MEDSIM_DEBUG_EVIDENCE", "").lower() in {"1", "true", "yes"}:
                    logging.getLogger("medsim.evidence").info(
                        "patient-turn attempt=%s source=%s question_id=%s intent=%s provenance=%s",
                        req.attemptId, req.source, recorded_question_id, record_intent_id, provenance,
                    )
            # Buffering and sanitization are complete before any text is emitted.
            for offset in range(0, len(response_text), 32):
                yield _sse({"text": response_text[offset:offset + 32], "correlationId": correlation_id})
                await asyncio.sleep(0)
            yield _sse({
                "done": True, "correlationId": correlation_id,
                "provenance": provenance, "actualModel": actual_model,
                "matchConfidence": record_match_confidence,
                "intentId": record_intent_id, "matchedSource": record_matched_source,
            })
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            category, _message, _retryable = _safe_error_category(exc)
            logging.getLogger("medsim.local_ai").warning("patient inference failed: %s", category)
            yield _sse({"text": SAFE_UNKNOWN_RESPONSE, "correlationId": correlation_id})
            yield _sse({"done": True, "correlationId": correlation_id, "provenance": "safe-unknown", "actualModel": None})
        finally:
            with _INVESTIGATION_LOCK:
                try:
                    _get_attempt(request, req.attemptId)["patientRequestActive"] = False
                except HTTPException:
                    pass

    return StreamingResponse(
        generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/api/local-ai/evaluate")
async def evaluate_encounter(payload: EvaluationRequest, request: Request):
    with _INVESTIGATION_LOCK:
        attempt = _get_attempt(request, payload.attemptId)
        if payload.caseId != attempt["caseId"] or payload.caseVersion != attempt["caseVersion"]:
            raise HTTPException(status_code=409, detail="attempt provenance mismatch")
        if payload.variantSeed != attempt["variantSeed"]:
            raise HTTPException(status_code=409, detail="attempt variant mismatch")
        if any(item.attemptId != payload.attemptId for item in payload.transcript):
            raise HTTPException(status_code=409, detail="transcript attempt provenance mismatch")
        if any(item.attemptId != payload.attemptId for item in payload.examinations):
            raise HTTPException(status_code=409, detail="examination attempt provenance mismatch")
        if attempt["evaluationResult"] is not None:
            return copy.deepcopy(attempt["evaluationResult"])
        if attempt["evaluationActive"]:
            raise HTTPException(status_code=409, detail="An evaluation is already in progress for this encounter.")
        attempt["evaluationActive"] = True
        case = attempt["localAiCase"]
        investigation_case = _INVESTIGATION_CASES[attempt["caseId"]]
        catalogue = {item["testId"]: item for item in investigation_case["investigations"]}
        server_orders = []
        for order in attempt["orders"].values():
            released = order.get("releasedAt") is not None
            safe_order = _public_order(order, include_result=released)
            definition = catalogue.get(order["investigationId"], {})
            safe_order["role"] = definition.get("role")
            safe_order["availability"] = definition.get("availability")
            safe_order["released"] = released
            server_orders.append(safe_order)
        asked_ids = list(attempt["askedQuestionIds"])
        ordered_ids = {item["investigationId"] for item in server_orders}
        essential_ids = {item["testId"] for item in investigation_case["investigations"] if item.get("role") == "essential"}
        investigation_authority = {
            "essential_total": len(essential_ids),
            "essential_ordered": len(essential_ids & ordered_ids),
            "relevant_ordered": sum(item.get("role") in {"essential", "useful"} for item in server_orders),
            "harmful_ordered": sum(item.get("role") == "harmful" for item in server_orders),
            "results_released": sum(bool(item.get("released")) for item in server_orders),
        }

    evidence = {
        "asked_question_ids": asked_ids,
        "transcript": [item.model_dump() for item in payload.transcript],
        "examinations": [item.model_dump() for item in payload.examinations],
        "treatments": list(dict.fromkeys(payload.treatmentIds)),
        "prescriptions": [item.model_dump() for item in payload.prescriptions],
        "submitted_diagnosis_id": payload.submittedDiagnosisId,
        "completion_checks": None if payload.completionChecks is None else {
            "summary_completed": payload.completionChecks.summaryCompleted,
            "safety_netting_completed": payload.completionChecks.safetyNettingCompleted,
            "ideas_concerns_expectations_completed": payload.completionChecks.ideasConcernsExpectationsCompleted,
        },
        "investigation_authority": investigation_authority,
    }
    if os.environ.get("MEDSIM_DEBUG_EVIDENCE", "").lower() in {"1", "true", "yes"}:
        logging.getLogger("medsim.evidence").info(
            "debrief attempt=%s case=%s questions=%d transcript=%d examinations=%d investigations=%d treatments=%d prescriptions=%d diagnosis=%s rubric=%s",
            payload.attemptId, payload.caseId, len(asked_ids), len(payload.transcript), len(payload.examinations),
            len(server_orders), len(payload.treatmentIds), len(payload.prescriptions), bool(payload.submittedDiagnosisId),
            ",".join(item["criterionId"] for item in case["evaluation"]["rubric"]),
        )
    system, user = evaluation_prompt(case, evidence, server_orders)
    model_result: dict[str, Any] | None = None
    actual_model: str | None = None
    correlation_id = secrets.token_urlsafe(12)
    error_category: str | None = None
    provider = get_local_llm_provider()
    readiness = None
    try:
        async with asyncio.timeout(3.5):
            readiness = await provider.health()
            if readiness.state != "ready" or readiness.safety_status.startswith("unsafe"):
                error_category = "low-memory" if readiness.safety_status.startswith("unsafe") else readiness.last_error_category or "evaluation-unavailable"
            else:
                completion = await provider.structured_completion(
                    StructuredRequest(system=system, user=user, max_tokens=700, temperature=0.0, request_id=correlation_id),
                    EVALUATION_SCHEMA,
                )
                actual_model = completion.actual_model
                if validate_model_evaluation(case, completion.value):
                    model_result = completion.value
                error_category = "invalid-evaluator-schema"
                if model_result is not None:
                    error_category = None
    except TimeoutError:
        error_category = "evaluation-timeout"
    except LLMProviderError as exc:
        error_category = exc.category
        actual_model = exc.actual_model
    except Exception:
        error_category = "evaluation-unavailable"
    result = normalize_evaluation(case, evidence, server_orders, model_result)
    if result["generation"].pop("rejected_model_evidence", False) and error_category is None:
        error_category = "ungrounded-evaluator-evidence"
    result["generation"].update({
        "error_category": error_category,
        "provider": readiness.provider if readiness else "deterministic",
        "configured_model": (readiness.model or None) if readiness else None,
        "actual_model": actual_model,
        "request_id": correlation_id,
    })
    with _INVESTIGATION_LOCK:
        current = _get_attempt(request, payload.attemptId)
        current["evaluationActive"] = False
        current["evaluationResult"] = copy.deepcopy(result)
    return result


@app.get("/health")
async def health():
    try:
        tts_status = get_tts_manager().health()
    except TTSConfigurationError as exc:
        tts_status = {"configured": False, "error": str(exc)}
    llm = health_dict(await get_local_llm_provider().health())
    return {
        "ok": True,
        "patient_tts": tts_status,
        "local_ai": llm,
        "evaluation_mode": llm_settings().evaluation_mode,
        "patient_ready": llm["state"] == "ready" and not llm["safety_status"].startswith("unsafe"),
        # Evaluation always has an authoritative deterministic fallback.
        "evaluator_ready": True,
        "last_safe_error_category": llm["last_error_category"],
    }


class PatientTTSRequestBody(BaseModel):
    text: str
    caseId: str
    gender: str = "M"
    isPediatric: bool = False
    speed: Optional[float] = None
    language: str = "en"
    caseVersion: str = Field(default="", max_length=120)
    isOpeningGreeting: bool = False
    cacheable: bool = False
    requestId: str = Field(default="", max_length=100)


@app.post("/tts/synthesize")
async def synthesize_patient_speech(req: PatientTTSRequestBody):
    if not req.text.strip() or len(req.text) > 2000:
        raise HTTPException(status_code=422, detail="Patient text must contain 1 to 2000 characters")
    if req.gender not in {"M", "F"}:
        raise HTTPException(status_code=422, detail="gender must be M or F")
    if req.speed is not None and not 0.7 <= req.speed <= 1.3:
        raise HTTPException(status_code=422, detail="speed must be between 0.7 and 1.3")
    if req.language != TTS_SETTINGS.language:
        raise HTTPException(status_code=422, detail="language must match server PATIENT_TTS_LANGUAGE")
    try:
        result = await get_tts_manager().synthesize(TTSRequest(
            text=req.text, case_id=req.caseId, gender=req.gender,
            is_pediatric=req.isPediatric, speed=req.speed, language=req.language,
            case_version=req.caseVersion, is_opening_greeting=req.isOpeningGreeting,
            cacheable=req.cacheable, request_id=req.requestId,
        ))
    except (TTSConfigurationError, TTSProviderError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=result.audio,
        media_type=result.media_type,
        headers={
            "Cache-Control": "no-store",
            "X-Patient-TTS-Provider": result.provider,
            "X-Patient-TTS-Voice": result.voice,
            "X-Patient-TTS-Cache": "hit" if result.cache_hit else "miss",
            "X-Patient-TTS-Normalized": result.synthesized_text.encode("ascii", "ignore").decode("ascii")[:500],
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")

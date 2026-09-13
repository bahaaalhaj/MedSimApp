"""
FastAPI backend for the MedSim simulator.

Hosts the Claude Managed Agents proxy (medsim-attending grading), the
text-only AI patient endpoint, and local patient text-to-speech.

GET  /health         → backend + agent status report
POST /agent/...      → Managed Agents proxy (medsim-attending)
POST /tts/synthesize → synthesize patient speech locally
"""

from __future__ import annotations

import os
import json
import threading
import copy
import hashlib
import secrets
import time
from pathlib import Path
from typing import Any, Optional


def _load_env_local() -> None:
    """Minimal .env.local loader — no python-dotenv dependency.

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
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from auth_system import AuthApi, AuthSettings, build_auth_router
from tts import TTSConfigurationError, TTSProviderError, TTSRequest, get_tts_manager, load_tts_settings

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

app = FastAPI(title="MedSim Backend", version="0.2.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Middleware ORDER (inside-out — last added runs first on inbound):
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


class CreateClinicalAttemptRequest(BaseModel):
    caseId: str
    caseVersion: str


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


@app.post("/api/attempts", status_code=201)
def create_clinical_attempt(payload: CreateClinicalAttemptRequest, request: Request):
    clinical_case = _INVESTIGATION_CASES.get(payload.caseId)
    if not clinical_case or clinical_case["caseVersion"] != payload.caseVersion:
        raise HTTPException(status_code=404, detail="assignable case/version not found")
    attempt_id = secrets.token_urlsafe(32)
    attempt = {
        "attemptId": attempt_id, "owner": _attempt_owner(request), "caseId": payload.caseId,
        "caseVersion": payload.caseVersion, "createdAt": time.time(),
        "expiresAt": time.time() + _ATTEMPT_TTL_SECONDS, "orders": {}, "orderByInvestigation": {},
    }
    with _INVESTIGATION_LOCK:
        _INVESTIGATION_ATTEMPTS[attempt_id] = attempt
    return {
        "attemptId": attempt_id, "caseId": payload.caseId, "caseVersion": payload.caseVersion,
        "investigations": [_safe_investigation(item) for item in clinical_case["investigations"]],
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
        return _public_order(order, include_result=True)


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


@app.get("/health")
def health():
    """Frontend polls this before showing the attending dock so a missing
    API key or unbootstrapped agent surfaces a clearer error than a blank
    SSE failure."""
    has_key = bool(os.environ.get("ANTHROPIC_API_KEY"))
    agent_id = os.environ.get("MEDSIM_AGENT_ID") or None
    env_id = os.environ.get("MEDSIM_ENV_ID") or None
    bootstrapped = bool(agent_id and env_id)
    try:
        tts_settings = TTS_SETTINGS
        tts_status = {
            "configured": True,
            "provider": tts_settings.provider,
            "device": tts_settings.device,
            "fallback": tts_settings.fallback,
            "chatterbox_enabled": tts_settings.enable_chatterbox,
        }
    except TTSConfigurationError as exc:
        tts_status = {"configured": False, "error": str(exc)}
    return {
        "ok": True,
        "patient_tts": tts_status,
        "agent": {
            "anthropic_sdk_installed": _HAS_ANTHROPIC,
            "api_key_configured": has_key,
            "bootstrapped": bootstrapped,
            "agent_id": agent_id,
            "environment_id": env_id,
            "model": AGENT_MODEL if _HAS_ANTHROPIC else None,
        },
    }


# ───────────────────────────────────────────────────────────────────────────
# Claude Managed Agents proxy
# ───────────────────────────────────────────────────────────────────────────
#
# The browser talks to this server instead of the Anthropic API directly so
# that (a) the Managed Agents API key stays server-side and (b) the
# one-time bootstrap (agents.create + environments.create) is done here
# once and the resulting IDs are reused across sessions.
#
# Per-env vars:
#   ANTHROPIC_API_KEY  — required. Server-side only; never exposed to the
#                        browser. Separate from VITE_ANTHROPIC_API_KEY used
#                        by the browser Haiku patient-persona path.
#   MEDSIM_AGENT_ID    — persisted agent ID (bootstrap returns it the
#                        first time; set it here afterwards to skip
#                        re-creating).
#   MEDSIM_ENV_ID      — persisted environment ID (same pattern).
#
# Endpoints:
#   POST /agent/bootstrap                      — idempotent; creates
#                                                env+agent if the env vars
#                                                are unset, else returns
#                                                the cached IDs.
#   POST /agent/sessions                       — create a new session for
#                                                the current bootstrapped
#                                                agent.
#   GET  /agent/sessions/{sid}/stream          — SSE proxy of the live
#                                                event stream. Used by
#                                                eventStreamRenderer.tsx.
#   GET  /agent/sessions/{sid}/events          — paginated history (for
#                                                the reconnect+dedupe
#                                                pattern).
#   POST /agent/sessions/{sid}/events          — forward user events
#                                                (user.message,
#                                                user.custom_tool_result,
#                                                user.interrupt, etc.).
#   POST /agent/vault/ehr/lookup               — credential-vault demo:
#                                                attaches EHR_API_TOKEN
#                                                server-side and returns
#                                                a fake record. The token
#                                                never leaves the process.
#
# TODO: verify wire names against
# https://platform.claude.com/docs/en/managed-agents/ before submission —
# the SDK is beta and field names can drift.

import asyncio
import json
import logging

from fastapi import Request
from fastapi.responses import StreamingResponse

try:
    from anthropic import Anthropic, AsyncAnthropic  # type: ignore
    _HAS_ANTHROPIC = True
except ImportError:  # pragma: no cover
    _HAS_ANTHROPIC = False

# Structured logger for the Managed Agents proxy. Uvicorn captures stdlib
# logging so these land in the same stream as its own access log.
_agent_log = logging.getLogger("medsim.agent")
_agent_log.setLevel(logging.INFO)
if not _agent_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[medsim.agent] %(levelname)s %(message)s"))
    _agent_log.addHandler(_h)

# Guards against two concurrent /agent/bootstrap calls creating two
# agents + two environments. Threading.Lock because bootstrap runs in
# FastAPI's threadpool (sync endpoint).
_bootstrap_lock = threading.Lock()

# SSE keepalive. EventSource will silently time out if the connection is
# idle past the browser's threshold (~30s for Chrome, longer elsewhere).
# We emit an SSE comment line every N seconds so the socket stays warm
# and the browser's `onerror` reconnect logic doesn't fire.
SSE_KEEPALIVE_SEC = 15.0


AGENT_MODEL = "claude-opus-4-7"
AGENT_NAME = "medsim-attending"
ENV_NAME = "medsim-attending-env"

MEDSIM_ATTENDING_SYSTEM_PROMPT = (
    "You are the attending physician supervising a trainee in a clinical "
    "training simulator. Your role is to OBSERVE their decisions and "
    "GRADE the encounter. You are NOT an assistant, a guide, or a "
    "coach. Silence is acceptable and often correct.\n\n"

    "The simulator is an outpatient polyclinic with one patient at a "
    "time and instant test results. Events include "
    "[polyclinic arrival], [poly test], [poly diagnosis], [poly rx], "
    "[disposition].\n\n"

    "Custom-tool usage:\n"
    "  • Available tools: render_vitals_chart, render_patient_timeline, "
    "render_case_evaluation, flag_critical_finding, lookup_ehr_history.\n"

    "Permission policy — custom tools:\n"
    "  • All render_* tools are auto-allowed; the trainee's UI renders "
    "them immediately and acks back to you. Use them freely.\n"
    "  • flag_critical_finding is a confirm-gated write. The trainee "
    "sees an approve/decline dialog before the banner fires; the "
    "tool_result is delayed until they choose. Reserve it for peri-"
    "arrest vitals, closing stroke window, airway compromise, or "
    "anaphylaxis. Never flag stable patients, and emit at most one "
    "flag per encounter.\n"
    "  • lookup_ehr_history is auto-allowed; it routes through the "
    "credential vault so the EHR auth token never enters your context. "
    "Call it once per patient when prior history or medication list "
    "would change your assessment (e.g., unclear cardiac history, "
    "possible drug interaction). Do not call it for every consultation.\n\n"

    "What you DO:\n"
    "  • On [polyclinic arrival]: stay silent. Do not greet the patient "
    "or ask the trainee what they want to do.\n"
    "  • At debrief time (see DEBRIEF MODE below): emit exactly one "
    "render_case_evaluation. Never emit it before the trainee has "
    "submitted a diagnosis.\n"
    "  • Any text you do emit: at most one sentence, observational tone, "
    "no questions.\n\n"

    "What you DO NOT do:\n"
    "  • Do not ask the trainee questions ('what would you like to do "
    "first?'). Never.\n"
    "  • Do not narrate the scene ('Mr. Williams is roomed and ready.').\n"
    "  • Do not suggest next steps before the trainee has acted.\n"
    "  • Do not repeat what the trainee can already see in the UI.\n"
    "  • Do not reveal the correct diagnosis before disposition.\n\n"

    "DEBRIEF MODE — end-of-encounter grading.\n\n"

    "When you receive a [debrief request] message, the trainee has ended "
    "the encounter. The message body contains, as JSON:\n"
    "  • case_id and the case's correctDiagnosisId (gold standard).\n"
    "  • rubric — a CaseRubric with three domains "
    "(data_gathering, clinical_management, interpersonal) plus optional "
    "safety_netting. Each criterion has a label, weight, and an "
    "`evidence` string telling you exactly what counts as 'met'.\n"
    "  • registry_slice — the subset of guidelines/recommendations cited "
    "by the rubric. Use ONLY recIds that appear here. Do not invent.\n"
    "  • prescription_validation — deterministic case-specific medication "
    "matching; do not upgrade not-reviewed details to correct.\n"
    "  • encounter_log — chronological list of: history questions asked "
    "(with answers shown to the trainee), tests ordered with timestamps, "
    "treatments/prescriptions given, the submitted diagnosis, and any "
    "free-text counselling captured. Plus the voice transcript if "
    "available.\n\n"

    "Process:\n"
    "  1. For every criterion in rubric.data_gathering, "
    "rubric.clinical_management, and rubric.interpersonal, decide one of "
    "{met, partially-met, missed} using the criterion's `evidence` field "
    "as your match key. Quote the trainee directly or name the action "
    "in the `evidence` field of your output (not the rubric's evidence "
    "string — your own observation).\n"
    "  2. Return criterion verdicts and provisional domain scores required "
    "by the tool schema. The application discards those arithmetic values "
    "and deterministically recomputes raw, max, verdict bands, and the global "
    "rating from immutable rubric weights. Never rewrite weights or add "
    "criteria.\n"
    "  3. Treat absent recorded evidence as insufficient evidence; never "
    "invent an action or infer that it happened.\n"
    "  4. If the trainee did anything dangerous — contraindicated drug, "
    "missed a red-flag escalation that the rubric flagged, no safety-"
    "netting on a high-risk diagnosis — set safety_breach with `what` "
    "and a guideline_ref if one applies. The narrative MUST lead with "
    "this regardless of the score.\n"
    "  5. Pick 1–3 highlights (specific strengths the trainee actually "
    "demonstrated) and 1–3 improvements (priority gaps). Do not list "
    "everything; the trainee tunes out.\n"
    "  6. Write narrative last, 1–2 paragraphs, voice of a senior "
    "clinician giving a teaching debrief immediately after the case. "
    "No praise sandwiches, no sycophancy, no generic encouragement.\n"
    "  7. Emit ONE render_case_evaluation tool use with the full payload. "
    "Then stop.\n\n"

    "Hard rules — non-negotiable:\n"
    "  • Cite, don't invent. Every clinical_management criterion's "
    "guideline_ref MUST appear in the registry_slice. If the rubric "
    "criterion has no guideline_ref AND no rec applies, drop the "
    "criterion from your output rather than fabricating one.\n"
    "  • Specific evidence. 'You missed ICE' is not enough. 'You closed "
    "without asking what the patient was worried about — they hinted at "
    "fear of stroke when they mentioned their father; that was a chance "
    "to address concerns and tailor the explanation.' is the bar.\n"
    "  • No medical advice for real patients. This is a training "
    "simulator. Do not frame any output as guidance for actual care.\n"
    "  • Cases are synthetic and doses simplified — do not hold the "
    "trainee to a recommendation that is not in the registry_slice.\n\n"

    "Scope: the cases are synthetic, the medication doses are simplified, "
    "and the trainee is not a licensed clinician. Do not offer medical "
    "advice outside the simulator."
)

# Custom tool JSON schemas — must match the Zod schemas in
# src/agents/customTools.ts. If you change either side, update both.
MEDSIM_CUSTOM_TOOLS: list[dict] = [
    {
        "type": "custom",
        "name": "render_vitals_chart",
        "description": (
            "Display the patient's vitals (HR, BP, SpO2, temp, RR) as a "
            "line chart over the course of the encounter."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {"type": "string"},
            },
            "required": ["patient_id"],
        },
    },
    {
        "type": "custom",
        "name": "render_patient_timeline",
        "description": (
            "Display the tests ordered and treatments given for a patient "
            "in chronological order."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {"type": "string"},
            },
            "required": ["patient_id"],
        },
    },
    {
        # End-of-encounter OSCE debrief. Replaces the older
        # `render_case_grade` (a flat score+notes blob): this one carries
        # a per-criterion verdict, three-domain scores, citations into the
        # guideline registry the frontend ships with the debrief request,
        # and a 1–2 paragraph spoken-aloud narrative. The renderer
        # `<CaseEvaluationCard>` resolves every `guideline_ref` against the
        # registry and shows a verbatim cite-card next to each criterion.
        #
        # The Zod schema in src/agents/customTools.ts must mirror this; if
        # you change one, update the other.
        "type": "custom",
        "name": "render_case_evaluation",
        "description": (
            "End-of-encounter PLAB2-style debrief. Emit exactly once after "
            "the trainee submits their diagnosis (and prescription, in "
            "polyclinic). Score three domains (data_gathering, clinical_"
            "management, interpersonal) against the case rubric provided "
            "in the debrief request. Each criterion verdict (met / "
            "partially-met / missed) must be backed by a transcript quote "
            "or a named action. Every clinical_management criterion's "
            "guideline_ref MUST be a real recommendation id present in the "
            "guideline registry slice that accompanies the debrief request "
            "— if no rec applies, drop the criterion. Never fabricate."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "case_id": {"type": "string"},
                "global_rating": {
                    "type": "string",
                    "enum": [
                        "clear-fail",
                        "borderline",
                        "satisfactory",
                        "good",
                        "excellent",
                    ],
                },
                "domain_scores": {
                    "type": "object",
                    "properties": {
                        "data_gathering": {
                            "type": "object",
                            "properties": {
                                "raw": {"type": "number"},
                                "max": {"type": "number"},
                                "verdict": {
                                    "type": "string",
                                    "enum": [
                                        "clear-fail",
                                        "borderline",
                                        "satisfactory",
                                        "good",
                                        "excellent",
                                    ],
                                },
                            },
                            "required": ["raw", "max", "verdict"],
                        },
                        "clinical_management": {
                            "type": "object",
                            "properties": {
                                "raw": {"type": "number"},
                                "max": {"type": "number"},
                                "verdict": {
                                    "type": "string",
                                    "enum": [
                                        "clear-fail",
                                        "borderline",
                                        "satisfactory",
                                        "good",
                                        "excellent",
                                    ],
                                },
                            },
                            "required": ["raw", "max", "verdict"],
                        },
                        "interpersonal": {
                            "type": "object",
                            "properties": {
                                "raw": {"type": "number"},
                                "max": {"type": "number"},
                                "verdict": {
                                    "type": "string",
                                    "enum": [
                                        "clear-fail",
                                        "borderline",
                                        "satisfactory",
                                        "good",
                                        "excellent",
                                    ],
                                },
                            },
                            "required": ["raw", "max", "verdict"],
                        },
                    },
                    "required": [
                        "data_gathering",
                        "clinical_management",
                        "interpersonal",
                    ],
                },
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "criterion_id": {"type": "string"},
                            "domain": {
                                "type": "string",
                                "enum": [
                                    "data_gathering",
                                    "clinical_management",
                                    "interpersonal",
                                ],
                            },
                            "verdict": {
                                "type": "string",
                                "enum": ["met", "partially-met", "missed"],
                            },
                            "evidence": {"type": "string"},
                            "guideline_ref": {
                                "type": ["string", "null"],
                                "description": (
                                    "Format: '<guideline_id>:<rec_id>'. "
                                    "Required for clinical_management; "
                                    "optional elsewhere; null if not "
                                    "applicable."
                                ),
                            },
                        },
                        "required": [
                            "criterion_id",
                            "domain",
                            "verdict",
                            "evidence",
                        ],
                    },
                },
                "safety_breach": {
                    "type": ["object", "null"],
                    "description": (
                        "Set ONLY when the trainee did something dangerous "
                        "(contraindicated drug, missed red flag, no safety-"
                        "netting on a high-risk dx). The narrative must "
                        "lead with this regardless of total score."
                    ),
                    "properties": {
                        "what": {"type": "string"},
                        "guideline_ref": {"type": ["string", "null"]},
                    },
                },
                "highlights": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "1–3 specific strengths.",
                },
                "improvements": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "1–3 priority improvements.",
                },
                "narrative": {
                    "type": "string",
                    "description": (
                        "1–2 paragraph teaching debrief, written as if "
                        "spoken aloud by a senior clinician. No praise "
                        "sandwiches, no sycophancy."
                    ),
                },
            },
            "required": [
                "case_id",
                "global_rating",
                "domain_scores",
                "criteria",
                "highlights",
                "improvements",
                "narrative",
            ],
        },
    },
    {
        # Write-shaped tool: surfaces a disruptive banner in the trainee
        # UI. Gated by the frontend permission policy — the renderer shows
        # an approve/decline dialog and only acks once the human confirms.
        # Custom tools aren't covered by Anthropic's own permission-policy
        # gate (that's native + MCP tools only), so the confirm happens
        # client-side in src/agents/eventStreamRenderer.tsx.
        "type": "custom",
        "name": "flag_critical_finding",
        "description": (
            "Raise a disruptive critical-finding banner on the trainee's "
            "screen. Use ONLY when the patient is in imminent risk (peri-"
            "arrest vitals, stroke window closing, anaphylaxis). Requires "
            "explicit human confirmation before firing; do not expect the "
            "result immediately."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {"type": "string"},
                "severity": {"type": "string", "enum": ["critical", "urgent"]},
                "reason": {"type": "string"},
            },
            "required": ["patient_id", "severity", "reason"],
        },
    },
    {
        # Credential-vault demo tool. When the agent emits this, the
        # browser calls POST /agent/vault/ehr/lookup. The backend attaches
        # the EHR auth token from server-side state (env var) and returns
        # the fake record. The EHR_API_TOKEN never touches the Claude
        # context or the browser — it's the "credential vault" pattern
        # from Michael's Managed Agents session, modeled for a demo.
        "type": "custom",
        "name": "lookup_ehr_history",
        "description": (
            "Retrieve the patient's prior EHR encounters and medication "
            "list from the hospital EHR system. The request is routed "
            "through the credential vault so your context never sees "
            "the EHR auth token."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "patient_id": {"type": "string"},
            },
            "required": ["patient_id"],
        },
    },
]

_anthropic_client: Optional["Anthropic"] = None
_anthropic_async_client: Optional["AsyncAnthropic"] = None


def _ensure_anthropic_available() -> None:
    if not _HAS_ANTHROPIC:
        raise HTTPException(
            status_code=500,
            detail=(
                "anthropic package not installed. Run `pip install "
                "'anthropic>=0.88.0'` in the backend venv."
            ),
        )


def _require_api_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set server-side.",
        )
    return key


def get_anthropic_client() -> "Anthropic":
    global _anthropic_client
    _ensure_anthropic_available()
    if _anthropic_client is None:
        _anthropic_client = Anthropic(api_key=_require_api_key())
    return _anthropic_client


def get_async_anthropic_client() -> "AsyncAnthropic":
    global _anthropic_async_client
    _ensure_anthropic_available()
    if _anthropic_async_client is None:
        _anthropic_async_client = AsyncAnthropic(api_key=_require_api_key())
    return _anthropic_async_client


class BootstrapResponse(BaseModel):
    agent_id: str
    agent_version: int | None
    environment_id: str
    created: bool  # True if we created them this call, False if cached


@app.post("/agent/bootstrap", response_model=BootstrapResponse)
def bootstrap_agent():
    """Idempotent: creates the medsim attending agent + environment if
    MEDSIM_AGENT_ID and MEDSIM_ENV_ID aren't set; otherwise returns the
    cached IDs.

    When `created=True` the caller should persist `agent_id` and
    `environment_id` into `backend/.env.local` (or the OS environment) so
    the next startup skips the create calls.

    The whole body runs under ``_bootstrap_lock`` so two racing clients
    (e.g. Strict Mode double-mount with a cold server) don't each create
    their own agent + environment.
    """
    with _bootstrap_lock:
        # Re-read env vars under the lock — if an earlier racing call
        # persisted the IDs (process-wide only; operator still needs to
        # write .env.local for cross-restart), we skip the create.
        agent_id = os.environ.get("MEDSIM_AGENT_ID")
        env_id = os.environ.get("MEDSIM_ENV_ID")
        if agent_id and env_id:
            return BootstrapResponse(
                agent_id=agent_id,
                agent_version=None,
                environment_id=env_id,
                created=False,
            )

        client = get_anthropic_client()
        try:
            env = client.beta.environments.create(  # type: ignore[attr-defined]
                name=ENV_NAME,
                config={"type": "cloud", "networking": {"type": "unrestricted"}},
            )
            agent = client.beta.agents.create(  # type: ignore[attr-defined]
                name=AGENT_NAME,
                model=AGENT_MODEL,
                system=MEDSIM_ATTENDING_SYSTEM_PROMPT,
                tools=[
                    {"type": "agent_toolset_20260401", "default_config": {"enabled": True}},
                    *MEDSIM_CUSTOM_TOOLS,
                ],
            )
        except Exception as e:
            _agent_log.exception("bootstrap failed")
            raise HTTPException(status_code=500, detail=f"bootstrap failed: {e}")

        # Populate the in-process env vars so racing calls inside the same
        # server process pick up the cached IDs. Operator still needs to
        # persist them to backend/.env.local for the NEXT server restart.
        os.environ["MEDSIM_AGENT_ID"] = agent.id
        os.environ["MEDSIM_ENV_ID"] = env.id
        _agent_log.info(
            "bootstrap: created agent %s + env %s — persist these to "
            "backend/.env.local before restarting the server",
            agent.id, env.id,
        )

        return BootstrapResponse(
            agent_id=agent.id,
            agent_version=getattr(agent, "version", None),
            environment_id=env.id,
            created=True,
        )


class RefreshAgentResponse(BaseModel):
    agent_id: str
    version: int | None


@app.post("/agent/refresh", response_model=RefreshAgentResponse)
def refresh_agent():
    """Push the current in-file system prompt + custom tools up to the
    existing Agent object, creating a new version. Existing sessions keep
    their pinned version; new sessions pick up the latest.

    Use this whenever you edit ``MEDSIM_ATTENDING_SYSTEM_PROMPT`` or
    ``MEDSIM_CUSTOM_TOOLS`` so the change takes effect without creating a
    whole new Agent."""
    agent_id = os.environ.get("MEDSIM_AGENT_ID")
    if not agent_id:
        raise HTTPException(
            status_code=400,
            detail="MEDSIM_AGENT_ID not set. Run /agent/bootstrap first.",
        )
    client = get_anthropic_client()
    try:
        # update() is optimistic-concurrency: pass the current version so
        # we don't clobber a concurrent edit.
        current = client.beta.agents.retrieve(agent_id)  # type: ignore[attr-defined]
        updated = client.beta.agents.update(  # type: ignore[attr-defined]
            agent_id,
            version=current.version,
            system=MEDSIM_ATTENDING_SYSTEM_PROMPT,
            tools=[
                {"type": "agent_toolset_20260401", "default_config": {"enabled": True}},
                *MEDSIM_CUSTOM_TOOLS,
            ],
        )
    except Exception as e:
        _agent_log.exception("refresh failed")
        raise HTTPException(status_code=500, detail=f"refresh failed: {e}")
    _agent_log.info(
        "refresh: agent %s bumped to version %s",
        updated.id, getattr(updated, "version", None),
    )
    return RefreshAgentResponse(
        agent_id=updated.id,
        version=getattr(updated, "version", None),
    )


class CreateSessionRequest(BaseModel):
    title: Optional[str] = None


class CreateSessionResponse(BaseModel):
    session_id: str


@app.post("/agent/sessions", response_model=CreateSessionResponse)
def create_session(req: CreateSessionRequest):
    agent_id = os.environ.get("MEDSIM_AGENT_ID")
    env_id = os.environ.get("MEDSIM_ENV_ID")
    if not agent_id or not env_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "MEDSIM_AGENT_ID / MEDSIM_ENV_ID not set. Call POST /agent/bootstrap "
                "first and persist the returned IDs into the environment."
            ),
        )
    client = get_anthropic_client()
    try:
        session = client.beta.sessions.create(  # type: ignore[attr-defined]
            agent=agent_id,
            environment_id=env_id,
            title=req.title or "MedSim training shift",
        )
    except Exception as e:
        _agent_log.exception("create_session failed")
        raise HTTPException(status_code=500, detail=f"create_session failed: {e}")
    _agent_log.info("create_session: %s", session.id)
    return CreateSessionResponse(session_id=session.id)


@app.get("/agent/sessions/{session_id}")
async def get_session(session_id: str):
    """Fetch a session's status + usage. Used by debug tooling; the
    frontend hook doesn't need this path day-to-day."""
    client = get_async_anthropic_client()
    try:
        session = await client.beta.sessions.retrieve(session_id)  # type: ignore[attr-defined]
    except Exception as e:
        _agent_log.exception("get_session failed session_id=%s", session_id)
        raise HTTPException(status_code=500, detail=f"get_session failed: {e}")
    return (
        session.model_dump(mode="json")
        if hasattr(session, "model_dump")
        else dict(session)
    )


@app.post("/agent/sessions/{session_id}/events")
async def send_events(session_id: str, request: Request):
    try:
        body = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON body: {e}")
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list) or not events:
        raise HTTPException(status_code=400, detail="events must be a non-empty list")
    # Use the ASYNC client here — this endpoint is `async def`, so calling
    # the sync client would block uvicorn's event loop thread and starve
    # the SSE stream handlers running in the same loop.
    client = get_async_anthropic_client()
    try:
        await client.beta.sessions.events.send(  # type: ignore[attr-defined]
            session_id=session_id, events=events
        )
    except Exception as e:
        _agent_log.exception(
            "send_events failed session_id=%s event_count=%d",
            session_id, len(events),
        )
        raise HTTPException(status_code=500, detail=f"send_events failed: {e}")
    return {"ok": True}


@app.get("/agent/sessions/{session_id}/events")
async def list_events(session_id: str, limit: int = 1000):
    """Paginated history — used by the browser on reconnect to backfill
    events emitted while the SSE stream was down."""
    client = get_async_anthropic_client()
    try:
        page = await client.beta.sessions.events.list(  # type: ignore[attr-defined]
            session_id=session_id, limit=limit
        )
    except Exception as e:
        _agent_log.exception("list_events failed session_id=%s", session_id)
        raise HTTPException(status_code=500, detail=f"list_events failed: {e}")
    data = getattr(page, "data", None) or []
    return {
        "data": [
            e.model_dump(mode="json") if hasattr(e, "model_dump") else dict(e)
            for e in data
        ]
    }


@app.get("/agent/sessions/{session_id}/stream")
async def stream_events(session_id: str, request: Request):
    """SSE passthrough. Each Managed-Agents event becomes one SSE
    ``event:``/``data:`` pair so EventSource in the browser can dispatch
    by type.

    Uses the ASYNC Anthropic client so long-lived streams cooperate with
    FastAPI's event loop — a synchronous generator here would tie up a
    threadpool worker per open stream, and with hot-reloading + Strict
    Mode double-mount, those streams pile up and saturate the pool,
    which makes EVERY endpoint (including /health) stop responding.

    Three robustness features:
      1. ``request.is_disconnected()`` checked on every tick, so the
         upstream stream is released as soon as the browser closes its
         EventSource.
      2. ``asyncio.wait_for`` wraps ``anext`` with a timeout — if no
         upstream event arrives for ``SSE_KEEPALIVE_SEC`` seconds we
         emit a comment line (``: keepalive\\n\\n``) to keep the socket
         warm and to run the disconnect check. Without this the browser
         (Chrome ~30s, nginx default 60s, corporate proxies often less)
         can silently drop idle streams.
      3. Any exception bubbling out of the upstream SDK becomes a
         ``proxy_error`` SSE event so the client knows the pipe died
         instead of silently seeing EOF.
    """
    client = get_async_anthropic_client()

    async def generator():
        # Small preamble so proxies don't buffer the response.
        yield ": connected\n\n"
        try:
            # In the async SDK, events.stream() is a coroutine that
            # resolves to the async context manager — must be awaited
            # first. Synchronous SDK returns the context manager directly.
            stream_ctx = await client.beta.sessions.events.stream(  # type: ignore[attr-defined]
                session_id=session_id
            )
            async with stream_ctx as stream:
                aiter_stream = stream.__aiter__()
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        event = await asyncio.wait_for(
                            aiter_stream.__anext__(),
                            timeout=SSE_KEEPALIVE_SEC,
                        )
                    except asyncio.TimeoutError:
                        # No event from upstream in the keepalive window;
                        # poke the connection and loop to re-check
                        # is_disconnected.
                        yield ": keepalive\n\n"
                        continue
                    except StopAsyncIteration:
                        break
                    payload = (
                        event.model_dump(mode="json")
                        if hasattr(event, "model_dump")
                        else dict(event)
                    )
                    etype = payload.get("type", "message")
                    data = json.dumps(payload, default=str)
                    yield f"event: {etype}\ndata: {data}\n\n"
        except asyncio.CancelledError:
            # Client disconnected mid-await; let it propagate so the
            # upstream context manager (``async with``) cleans up, but
            # don't treat it as an error.
            raise
        except Exception as e:
            _agent_log.exception("SSE stream failed session_id=%s", session_id)
            err = json.dumps({"type": "proxy_error", "message": str(e)})
            yield f"event: proxy_error\ndata: {err}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disables nginx buffering if behind one
        },
    )


# ───────────────────────────────────────────────────────────────────────────
# Credential vault — hospital EHR stub
# ───────────────────────────────────────────────────────────────────────────
#
# Demo of Michael's "credential vault" pattern: a third-party system
# (fake hospital EHR) needs an auth token to query patient history. The
# token lives ONLY on the backend (EHR_API_TOKEN env var). The agent's
# context window never sees it, the browser never sees it, and it never
# appears in any event written to the Managed Agents session.
#
# Flow:
#   1. Agent emits agent.custom_tool_use name=lookup_ehr_history.
#   2. Browser receives the event, POSTs to /agent/vault/ehr/lookup.
#   3. This endpoint attaches EHR_API_TOKEN server-side, calls the fake
#      EHR (local dict for the demo; would be an HTTP call in prod),
#      and returns the history JSON.
#   4. Browser posts the JSON back as user.custom_tool_result.
#
# Logging is intentionally token-free — the log line records that the
# vault was used and which patient was queried, but never the token
# value. A grep for the token in logs should return zero hits.

FAKE_EHR_RECORDS: dict[str, dict] = {
    "poly-001": {
        "patient_id": "poly-001",
        "name": "Mehmet Demir",
        "prior_encounters": [
            {"date": "2025-11-14", "reason": "hypertension follow-up", "bp": "148/92"},
            {"date": "2025-07-02", "reason": "annual physical", "bp": "140/88"},
        ],
        "active_medications": [
            {"name": "lisinopril", "dose": "10 mg", "frequency": "daily"},
            {"name": "atorvastatin", "dose": "20 mg", "frequency": "nightly"},
        ],
        "allergies": ["penicillin — hives"],
    },
    "poly-002": {
        "patient_id": "poly-002",
        "name": "Ayşe Kaya",
        "prior_encounters": [
            {"date": "2026-01-22", "reason": "asthma exacerbation", "peak_flow": 320},
        ],
        "active_medications": [
            {"name": "albuterol", "dose": "90 mcg", "frequency": "PRN"},
            {"name": "fluticasone", "dose": "110 mcg", "frequency": "BID"},
        ],
        "allergies": [],
    },
}


class EhrLookupRequest(BaseModel):
    patient_id: str


class EhrLookupResponse(BaseModel):
    patient_id: str
    record: dict
    fetched_via: str  # always "credential-vault"; demo label


def _vault_token_configured() -> bool:
    """Whether the EHR vault is operable. Tests can force a known value
    by setting ``EHR_API_TOKEN`` in the process environment before
    importing ``server``."""
    return bool(os.environ.get("EHR_API_TOKEN"))


@app.post("/agent/vault/ehr/lookup", response_model=EhrLookupResponse)
def vault_ehr_lookup(req: EhrLookupRequest):
    """Look up a patient's EHR record through the credential vault.

    The browser calls this in response to an
    ``agent.custom_tool_use`` for ``lookup_ehr_history``. The auth token
    is read from the server process's environment, attached to the
    downstream call (simulated here by a dict read), and the result is
    returned without the token ever appearing in the response body or
    in any log line.
    """
    patient_id = req.patient_id.strip()
    if not patient_id:
        raise HTTPException(status_code=400, detail="patient_id is required")
    if not _vault_token_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "EHR_API_TOKEN is not configured server-side. Set it in "
                "backend/.env.local to enable the vault."
            ),
        )
    record = FAKE_EHR_RECORDS.get(patient_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"patient_id not found: {patient_id}")
    # Token-free log line — demonstrates the vault pattern.
    _agent_log.info("vault: ehr lookup patient=%s", patient_id)
    return EhrLookupResponse(
        patient_id=patient_id,
        record=record,
        fetched_via="credential-vault",
    )


# ───────────────────────────────────────────────────────────────────────────
# ───────────────────────────────────────────────────────────────────────────
#
# ───────────────────────────────────────────────────────────────────────────
# Patient persona streaming — Haiku 4.5
# ───────────────────────────────────────────────────────────────────────────
#
# The browser used to call Anthropic directly with a VITE_ANTHROPIC_API_KEY
# (dangerouslyAllowBrowser). That shipped the key in every bundle. We now
# route patient-persona streaming through the backend so the key stays
# server-side. SSE frames carry `{"text": "..."}` deltas, terminated with
# `{"done": true}`. The Haiku response is short (max 256 tokens) so we
# skip the keepalive logic the long-lived agent stream needs.

PATIENT_MODEL = "claude-haiku-4-5"
PATIENT_MAX_TOKENS = 256


class PatientChatMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class PatientStreamRequest(BaseModel):
    system: str
    messages: list[PatientChatMessage]


@app.post("/agent/patient/stream")
async def patient_stream(req: PatientStreamRequest):
    client = get_async_anthropic_client()

    async def generator():
        try:
            async with client.messages.stream(  # type: ignore[attr-defined]
                model=PATIENT_MODEL,
                max_tokens=PATIENT_MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": req.system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[
                    {"role": m.role, "content": m.content} for m in req.messages
                ],
            ) as stream:
                async for event in stream:
                    etype = getattr(event, "type", None)
                    if etype != "content_block_delta":
                        continue
                    delta = getattr(event, "delta", None)
                    if getattr(delta, "type", None) != "text_delta":
                        continue
                    text = getattr(delta, "text", "")
                    if not text:
                        continue
                    yield "data: " + json.dumps({"text": text}) + "\n\n"
            yield "data: " + json.dumps({"done": True}) + "\n\n"
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _agent_log.exception("patient stream failed")
            yield "data: " + json.dumps({"error": str(e)}) + "\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ───────────────────────────────────────────────────────────────────────────
# Local patient text-to-speech
# ───────────────────────────────────────────────────────────────────────────
#
class PatientTTSRequestBody(BaseModel):
    text: str
    caseId: str
    gender: str = "M"
    isPediatric: bool = False
    speed: Optional[float] = None
    language: str = "en"


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
            "X-Patient-TTS-Normalized": result.synthesized_text.encode("ascii", "ignore").decode("ascii")[:500],
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info")

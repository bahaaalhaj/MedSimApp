from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from slowapi import Limiter
from slowapi.util import get_remote_address

from auth_system import AuthApi, AuthSettings, build_auth_router
from local_ai import LOCAL_AI_CASES
from tts import load_tts_settings

from .application import create_application
from .attempt_store import ATTEMPT_TTL_SECONDS, MAX_ACTIVE_ATTEMPTS_PER_OWNER, AttemptStore
from .config import load_env_local, load_runtime_settings
from .routes.attempts import register_attempt_routes
from .routes.catalogue import register_catalogue_routes
from .routes.diagnostics import register_diagnostics_routes
from .routes.evaluation import register_evaluation_routes
from .routes.investigations import register_investigation_routes
from .routes.patient_dialogue import register_patient_dialogue_routes
from .services.attempt_service import AttemptService
from .services.evaluation_service import EvaluationService
from .services.investigation_service import InvestigationService
from .services.patient_dialogue_service import PatientDialogueService


APPLICATION_ROOT = Path(__file__).resolve().parents[2]


def _load_safe_curated_cases() -> list[dict[str, Any]]:
    path = APPLICATION_ROOT / "docs" / "generated" / "curation-manifest.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cases = payload.get("safeCases", [])
        if payload.get("counts", {}).get("curated") != 72 or len(cases) != 72:
            raise ValueError("curation manifest must contain exactly 72 cases")
        return cases
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing curation manifest: {exc}") from exc


def _load_investigation_cases() -> dict[str, dict[str, Any]]:
    path = APPLICATION_ROOT / "docs" / "generated" / "investigation-manifest.server.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        cases = payload.get("cases", [])
        if len(cases) != 72:
            raise ValueError("investigation manifest must contain exactly 72 cases")
        return {item["caseId"]: item for item in cases}
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing investigation manifest: {exc}") from exc


@dataclass
class BackendRuntime:
    app: Any
    auth_api: AuthApi
    limiter: Limiter
    tts_settings: Any
    safe_curated_cases: list[dict[str, Any]]
    investigation_cases: dict[str, dict[str, Any]]
    attempt_store: AttemptStore
    attempt_service: AttemptService
    investigation_service: InvestigationService
    patient_dialogue_service: PatientDialogueService
    evaluation_service: EvaluationService


def create_runtime() -> BackendRuntime:
    load_env_local()
    runtime_settings = load_runtime_settings()
    tts_settings = load_tts_settings()
    limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
    app = create_application(runtime_settings, limiter)
    auth_api = AuthApi(AuthSettings.from_env())
    app.include_router(build_auth_router(auth_api, limiter))
    safe_curated_cases = _load_safe_curated_cases()
    investigation_cases = _load_investigation_cases()
    attempt_store = AttemptStore(auth_api)
    attempt_service = AttemptService(attempt_store, investigation_cases, LOCAL_AI_CASES, tts_settings)
    investigation_service = InvestigationService(attempt_store, investigation_cases)
    patient_dialogue_service = PatientDialogueService(attempt_store)
    evaluation_service = EvaluationService(attempt_store, investigation_cases, investigation_service)
    register_attempt_routes(app, attempt_service)
    register_investigation_routes(app, investigation_service)
    register_catalogue_routes(app, safe_curated_cases)
    register_patient_dialogue_routes(app, patient_dialogue_service)
    register_evaluation_routes(app, evaluation_service)
    register_diagnostics_routes(app, attempt_store.get, attempt_store.lock, tts_settings)
    return BackendRuntime(app, auth_api, limiter, tts_settings, safe_curated_cases, investigation_cases, attempt_store, attempt_service, investigation_service, patient_dialogue_service, evaluation_service)


runtime = create_runtime()

# Compatibility exports consumed by the current test suite and startup command.
app = runtime.app
auth_api = runtime.auth_api
limiter = runtime.limiter
TTS_SETTINGS = runtime.tts_settings
_SAFE_CURATED_CASES = runtime.safe_curated_cases
_INVESTIGATION_CASES = runtime.investigation_cases
_ATTEMPT_STORE = runtime.attempt_store
_INVESTIGATION_ATTEMPTS = runtime.attempt_store.attempts
_INVESTIGATION_LOCK = runtime.attempt_store.lock
_ATTEMPT_TTL_SECONDS = ATTEMPT_TTL_SECONDS
_MAX_ACTIVE_ATTEMPTS_PER_OWNER = MAX_ACTIVE_ATTEMPTS_PER_OWNER

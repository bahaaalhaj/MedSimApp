from __future__ import annotations

import asyncio
import copy
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request

from local_ai import SAFE_UNKNOWN_RESPONSE, compose_patient_answer, opening_greeting, public_profile
from tts import TTSRequest, get_tts_manager

from ..attempt_store import ATTEMPT_TTL_SECONDS, AttemptStore
from ..schemas import (
    AttemptCompletionRequest,
    AttemptDiagnosisRequest,
    AttemptExaminationRequest,
    AttemptPrescriptionRequest,
    CreateClinicalAttemptRequest,
)


class AttemptService:
    """The existing in-memory attempt lifecycle and recorded action semantics."""

    examination_action_ids = {"general-observation", "record-vital-signs", "focused-examination"}

    def __init__(
        self,
        store: AttemptStore,
        investigation_cases: dict[str, dict[str, Any]],
        local_ai_cases: dict[str, dict[str, Any]],
        tts_settings: Any,
    ):
        self.store = store
        self.investigation_cases = investigation_cases
        self.local_ai_cases = local_ai_cases
        self.tts_settings = tts_settings
        self._tts_prepare_tasks: set[asyncio.Task[None]] = set()

    @staticmethod
    def safe_investigation(investigation: dict[str, Any]) -> dict[str, Any]:
        allowed = ("testId", "name", "category", "role", "availability", "reason", "turnaroundSec", "prerequisite")
        return {key: investigation[key] for key in allowed if key in investigation}

    async def prepare_case_audio(self, local_ai_case: dict[str, Any], profile: dict[str, Any]) -> None:
        if self.tts_settings.provider != "kokoro":
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
        await get_tts_manager().prepare(requests)

    def schedule_case_audio(self, local_ai_case: dict[str, Any], profile: dict[str, Any]) -> None:
        task = asyncio.create_task(self.prepare_case_audio(local_ai_case, profile))
        self._tts_prepare_tasks.add(task)
        task.add_done_callback(self._tts_prepare_tasks.discard)

    async def create(self, payload: CreateClinicalAttemptRequest, request: Request) -> dict[str, Any]:
        clinical_case = self.investigation_cases.get(payload.caseId)
        if not clinical_case or clinical_case["caseVersion"] != payload.caseVersion:
            raise HTTPException(status_code=404, detail="assignable case/version not found")
        local_ai_case = self.local_ai_cases.get(payload.caseId)
        if not local_ai_case or local_ai_case["caseVersion"] != payload.caseVersion:
            raise HTTPException(status_code=404, detail="local AI case/version not found")
        try:
            profile = public_profile(local_ai_case, payload.patientProfile.model_dump() if payload.patientProfile else None)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        owner = self.store.owner(request)
        now = time.time()
        with self.store.lock:
            self.store.clean(now, owner)
            existing = next((item for item in self.store.attempts.values() if payload.clientAttemptId and
                item["owner"] == owner and item["caseId"] == payload.caseId and
                item["caseVersion"] == payload.caseVersion and item.get("clientAttemptId") == payload.clientAttemptId), None)
            if existing:
                return {
                    "attemptId": existing["attemptId"], "caseId": payload.caseId,
                    "caseVersion": payload.caseVersion,
                    "investigations": [self.safe_investigation(item) for item in clinical_case["investigations"]],
                    "openingGreeting": opening_greeting(existing["patientProfile"]),
                    "evidenceVersion": existing.get("evidenceVersion", 1),
                }
            attempt_id = secrets.token_urlsafe(32)
            attempt = {
                "attemptId": attempt_id, "owner": owner, "caseId": payload.caseId,
                "caseVersion": payload.caseVersion, "createdAt": now,
                "expiresAt": now + ATTEMPT_TTL_SECONDS, "orders": {}, "orderByInvestigation": {},
                "localAiCase": local_ai_case, "patientProfile": profile,
                "patientMessages": [], "askedQuestionIds": [], "variantSeed": payload.variantSeed,
                "clientAttemptId": payload.clientAttemptId, "evidenceVersion": payload.evidenceVersion,
                "patientRequestActive": False, "patientResponses": {},
                "transcript": [{"role": "patient", "content": opening_greeting(profile), "timestampIso": str(now), "questionSource": None}],
                "examinations": [], "treatments": [], "prescriptions": [],
                "submittedDiagnosisId": None, "completionChecks": None,
                "evaluationActive": False, "evaluationResult": None,
            }
            self.store.attempts[attempt_id] = attempt
        return {
            "attemptId": attempt_id, "caseId": payload.caseId, "caseVersion": payload.caseVersion,
            "investigations": [self.safe_investigation(item) for item in clinical_case["investigations"]],
            "openingGreeting": opening_greeting(profile), "evidenceVersion": payload.evidenceVersion,
        }

    def record_examination(self, attempt_id: str, payload: AttemptExaminationRequest, request: Request) -> dict[str, Any]:
        if payload.actionId not in self.examination_action_ids:
            raise HTTPException(status_code=422, detail="unknown examination action")
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            existing = next((item for item in attempt["examinations"] if item["actionId"] == payload.actionId), None)
            if existing:
                return copy.deepcopy(existing)
            item = {"actionId": payload.actionId, "performedAt": payload.performedAt, "attemptId": attempt_id}
            attempt["examinations"].append(item)
            return copy.deepcopy(item)

    def submit_diagnosis(self, attempt_id: str, payload: AttemptDiagnosisRequest, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            case = attempt["localAiCase"]
            if payload.diagnosisId not in set(case["evaluation"].get("diagnosisOptionIds", [])):
                raise HTTPException(status_code=422, detail="diagnosis is not available for this case")
            existing = attempt.get("submittedDiagnosisId")
            if existing is not None and existing != payload.diagnosisId:
                raise HTTPException(status_code=409, detail="a diagnosis has already been submitted")
            attempt["submittedDiagnosisId"] = payload.diagnosisId
            correct_id = case["evaluation"]["correctDiagnosisId"]
            return {"submittedDiagnosisId": payload.diagnosisId, "correctDiagnosisId": correct_id, "diagnosisWasCorrect": payload.diagnosisId == correct_id}

    def record_prescription(self, attempt_id: str, payload: AttemptPrescriptionRequest, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            if len(attempt["prescriptions"]) >= 64:
                raise HTTPException(status_code=422, detail="prescription limit reached")
            item = {"medicationId": payload.medicationId, "dose": payload.dose, "duration": payload.duration, "prescribedAt": payload.prescribedAt}
            if item not in attempt["prescriptions"]:
                attempt["prescriptions"].append(item)
            return copy.deepcopy(item)

    def record_completion(self, attempt_id: str, payload: AttemptCompletionRequest, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            attempt["completionChecks"] = payload.model_dump()
            return copy.deepcopy(attempt["completionChecks"])

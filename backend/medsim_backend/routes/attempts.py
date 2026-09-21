from __future__ import annotations

from fastapi import FastAPI, Request

from ..schemas import AttemptCompletionRequest, AttemptDiagnosisRequest, AttemptExaminationRequest, AttemptPrescriptionRequest, CreateClinicalAttemptRequest
from ..services.attempt_service import AttemptService


def register_attempt_routes(app: FastAPI, service: AttemptService) -> None:
    @app.post("/api/attempts", status_code=201)
    async def create_clinical_attempt(payload: CreateClinicalAttemptRequest, request: Request):
        return await service.create(payload, request)

    @app.post("/api/attempts/{attempt_id}/examinations", status_code=201)
    def record_attempt_examination(attempt_id: str, payload: AttemptExaminationRequest, request: Request):
        return service.record_examination(attempt_id, payload, request)

    @app.post("/api/attempts/{attempt_id}/diagnosis", status_code=201)
    def submit_attempt_diagnosis(attempt_id: str, payload: AttemptDiagnosisRequest, request: Request):
        return service.submit_diagnosis(attempt_id, payload, request)

    @app.post("/api/attempts/{attempt_id}/prescriptions", status_code=201)
    def record_attempt_prescription(attempt_id: str, payload: AttemptPrescriptionRequest, request: Request):
        return service.record_prescription(attempt_id, payload, request)

    @app.post("/api/attempts/{attempt_id}/completion", status_code=201)
    def record_attempt_completion(attempt_id: str, payload: AttemptCompletionRequest, request: Request):
        return service.record_completion(attempt_id, payload, request)

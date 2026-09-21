from __future__ import annotations

from fastapi import FastAPI, Request

from ..schemas import PatientTurnRequest
from ..services.patient_dialogue_service import PatientDialogueService


def register_patient_dialogue_routes(app: FastAPI, service: PatientDialogueService) -> None:
    @app.post("/agent/patient/stream")
    async def patient_stream(req: PatientTurnRequest, request: Request):
        return await service.stream(req, request)

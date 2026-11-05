from __future__ import annotations

from fastapi import FastAPI, Request

from ..schemas import DialogueAcknowledgement, PatientTurnRequest
from ..services.patient_dialogue_service import PatientDialogueService


def register_patient_dialogue_routes(app: FastAPI, service: PatientDialogueService) -> None:
    @app.post('/api/attempts/{attempt_id}/dialogue/acknowledgements')
    def acknowledge_dialogue(attempt_id: str, payload: DialogueAcknowledgement, request: Request):
        return service.acknowledge(attempt_id, payload.requestId, request)

    @app.post("/agent/patient/stream")
    async def patient_stream(req: PatientTurnRequest, request: Request):
        return await service.stream(req, request)

from __future__ import annotations

from fastapi import FastAPI, Request

from ..schemas import EvaluationRequest
from ..services.evaluation_service import EvaluationService


def register_evaluation_routes(app: FastAPI, service: EvaluationService) -> None:
    @app.post("/api/local-ai/evaluate")
    async def evaluate_encounter(payload: EvaluationRequest, request: Request):
        return await service.evaluate(payload, request)

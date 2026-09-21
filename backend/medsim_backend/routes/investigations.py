from __future__ import annotations

from fastapi import FastAPI, Request

from ..schemas import InvestigationOrderRequest
from ..services.investigation_service import InvestigationService


def register_investigation_routes(app: FastAPI, service: InvestigationService) -> None:
    @app.post("/api/attempts/{attempt_id}/investigations/orders", status_code=201)
    def order_investigation(attempt_id: str, payload: InvestigationOrderRequest, request: Request):
        return service.order(attempt_id, payload, request)

    @app.get("/api/attempts/{attempt_id}/investigations")
    def list_investigation_orders(attempt_id: str, request: Request):
        return service.list_orders(attempt_id, request)

    @app.get("/api/attempts/{attempt_id}/investigations/{order_id}")
    def get_investigation_result(attempt_id: str, order_id: str, request: Request):
        return service.result(attempt_id, order_id, request)

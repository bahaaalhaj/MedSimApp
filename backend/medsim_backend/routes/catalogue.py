from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException


def register_catalogue_routes(app: FastAPI, safe_cases: list[dict[str, Any]]) -> None:
    @app.get("/api/clinical/cases")
    def list_safe_cases(mode: str = "curated"):
        del mode
        return safe_cases

    @app.get("/api/clinical/cases/{case_id}")
    def get_safe_case(case_id: str, mode: str = "curated"):
        eligible = list_safe_cases(mode)
        case = next((item for item in eligible if item["caseId"] == case_id), None)
        if not case:
            raise HTTPException(status_code=404, detail="case not available in this training mode")
        return case

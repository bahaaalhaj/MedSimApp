from __future__ import annotations

import copy
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request

from ..attempt_store import AttemptStore
from ..schemas import InvestigationOrderRequest


class InvestigationService:
    """Existing order, availability, and safe result-release behavior."""

    def __init__(self, store: AttemptStore, investigation_cases: dict[str, dict[str, Any]]):
        self.store = store
        self.investigation_cases = investigation_cases

    @staticmethod
    def public_order(order: dict[str, Any], include_result: bool) -> dict[str, Any]:
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

    def order(self, attempt_id: str, payload: InvestigationOrderRequest, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            existing_id = attempt["orderByInvestigation"].get(payload.investigationId)
            if existing_id:
                return self.public_order(attempt["orders"][existing_id], include_result=False)
            clinical_case = self.investigation_cases.get(attempt["caseId"])
            if not clinical_case or clinical_case["caseVersion"] != attempt["caseVersion"]:
                raise HTTPException(status_code=409, detail="assigned case version is no longer available")
            investigation = next((item for item in clinical_case["investigations"] if item["testId"] == payload.investigationId), None)
            if not investigation:
                raise HTTPException(status_code=404, detail="investigation is not available for this case")
            now = time.time()
            orderable = investigation["availability"] in {"available-if-ordered", "result-available"} or (
                investigation["availability"] == "conditional" and bool(payload.indication.strip()) and investigation.get("structuredResult") is not None
            )
            order = {
                "orderId": secrets.token_urlsafe(24), "investigationId": payload.investigationId, "indication": payload.indication[:500],
                "orderedAt": now,
                "availableAt": now + min(2.0, max(0.05, float(investigation.get("turnaroundSec", 30)) / 100.0)) if orderable else now,
                "status": "pending" if orderable else "unavailable",
                "resultSnapshot": copy.deepcopy({
                    "investigationId": investigation["testId"], "name": investigation["name"], "category": investigation["category"],
                    "structuredResult": investigation.get("structuredResult"), "resultText": investigation.get("result", ""),
                    "abnormal": investigation.get("abnormal"), "verificationStatus": investigation.get("verificationStatus"),
                    "scoreable": investigation.get("scoreable", False),
                }) if orderable else None,
                "releasedAt": None,
                "statusDetail": None if orderable else (
                    "A documented indication is required before this conditional investigation can return a result."
                    if investigation["availability"] == "conditional"
                    else "This investigation is not indicated or is not modeled for this case version; no result was generated."
                ),
            }
            attempt["orders"][order["orderId"]] = order
            attempt["orderByInvestigation"][payload.investigationId] = order["orderId"]
            return self.public_order(order, include_result=False)

    def list_orders(self, attempt_id: str, request: Request) -> list[dict[str, Any]]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            return [self.public_order(order, include_result=False) for order in attempt["orders"].values()]

    def result(self, attempt_id: str, order_id: str, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, attempt_id)
            order = attempt["orders"].get(order_id)
            if not order:
                raise HTTPException(status_code=404, detail="investigation order not found")
            result = self.public_order(order, include_result=True)
            if order["status"] == "available" and result.get("resultSnapshot") is not None and order.get("releasedAt") is None:
                order["releasedAt"] = time.time()
            return result

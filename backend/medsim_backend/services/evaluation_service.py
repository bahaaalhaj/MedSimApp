from __future__ import annotations

import asyncio
import copy
import logging
import os
import secrets
from typing import Any

from fastapi import HTTPException, Request

from local_ai import EVALUATION_SCHEMA, LOCAL_AI_REFERENCES, evaluation_prompt, normalize_evaluation, validate_model_evaluation
from local_llm import LLMProviderError, StructuredRequest, get_local_llm_provider

from ..attempt_store import AttemptStore
from ..schemas import EvaluationRequest
from .investigation_service import InvestigationService


class EvaluationService:
    """Authoritative evidence, deterministic evaluation, and optional enrichment."""

    def __init__(self, store: AttemptStore, investigation_cases: dict[str, dict[str, Any]], investigations: InvestigationService):
        self.store = store
        self.investigation_cases = investigation_cases
        self.investigations = investigations

    async def evaluate(self, payload: EvaluationRequest, request: Request) -> dict[str, Any]:
        with self.store.lock:
            attempt = self.store.get(request, payload.attemptId)
            if payload.caseId != attempt["caseId"] or payload.caseVersion != attempt["caseVersion"]:
                raise HTTPException(status_code=409, detail="attempt provenance mismatch")
            if payload.variantSeed != attempt["variantSeed"]:
                raise HTTPException(status_code=409, detail="attempt variant mismatch")
            if any(item.attemptId != payload.attemptId for item in payload.transcript):
                raise HTTPException(status_code=409, detail="transcript attempt provenance mismatch")
            if any(item.attemptId != payload.attemptId for item in payload.examinations):
                raise HTTPException(status_code=409, detail="examination attempt provenance mismatch")
            if attempt.get("evidenceVersion", 1) == 1:
                for question_id in payload.askedQuestionIds:
                    if question_id not in attempt["askedQuestionIds"]:
                        attempt["askedQuestionIds"].append(question_id)
                if payload.transcript:
                    attempt["transcript"] = [item.model_dump() for item in payload.transcript]
                for item in payload.examinations:
                    dumped = item.model_dump()
                    if not any(existing["actionId"] == dumped["actionId"] for existing in attempt["examinations"]):
                        attempt["examinations"].append(dumped)
                if payload.treatmentIds:
                    attempt["treatments"] = list(dict.fromkeys(payload.treatmentIds))
                if payload.prescriptions:
                    attempt["prescriptions"] = [item.model_dump() for item in payload.prescriptions]
                if payload.submittedDiagnosisId is not None:
                    existing_diagnosis = attempt.get("submittedDiagnosisId")
                    if existing_diagnosis is not None and existing_diagnosis != payload.submittedDiagnosisId:
                        raise HTTPException(status_code=409, detail="submitted diagnosis does not match the attempt")
                    attempt["submittedDiagnosisId"] = payload.submittedDiagnosisId
                if payload.completionChecks is not None:
                    attempt["completionChecks"] = payload.completionChecks.model_dump()
            if attempt["evaluationResult"] is not None:
                return copy.deepcopy(attempt["evaluationResult"])
            if attempt["evaluationActive"]:
                raise HTTPException(status_code=409, detail="An evaluation is already in progress for this encounter.")
            attempt["evaluationActive"] = True
            case = attempt["localAiCase"]
            investigation_case = self.investigation_cases[attempt["caseId"]]
            catalogue = {item["testId"]: item for item in investigation_case["investigations"]}
            server_orders = []
            for order in attempt["orders"].values():
                released = order.get("releasedAt") is not None
                safe_order = self.investigations.public_order(order, include_result=released)
                definition = catalogue.get(order["investigationId"], {})
                safe_order["role"] = definition.get("role")
                safe_order["availability"] = definition.get("availability")
                safe_order["released"] = released
                server_orders.append(safe_order)
            asked_ids = list(attempt["askedQuestionIds"])
            ordered_ids = {item["investigationId"] for item in server_orders}
            essential_ids = {item["testId"] for item in investigation_case["investigations"] if item.get("role") == "essential"}
            investigation_authority = {
                "essential_total": len(essential_ids), "essential_ordered": len(essential_ids & ordered_ids),
                "relevant_ordered": sum(item.get("role") in {"essential", "useful"} for item in server_orders),
                "harmful_ordered": sum(item.get("role") == "harmful" for item in server_orders),
                "results_released": sum(bool(item.get("released")) for item in server_orders),
            }
        evidence = {
            "asked_question_ids": asked_ids, "transcript": copy.deepcopy(attempt["transcript"]), "examinations": copy.deepcopy(attempt["examinations"]),
            "treatments": copy.deepcopy(attempt["treatments"]), "prescriptions": copy.deepcopy(attempt["prescriptions"]),
            "submitted_diagnosis_id": attempt.get("submittedDiagnosisId"),
            "completion_checks": None if attempt.get("completionChecks") is None else {
                "summary_completed": attempt["completionChecks"]["summaryCompleted"], "safety_netting_completed": attempt["completionChecks"]["safetyNettingCompleted"],
                "ideas_concerns_expectations_completed": attempt["completionChecks"]["ideasConcernsExpectationsCompleted"],
            },
            "investigation_authority": investigation_authority,
        }
        if os.environ.get("MEDSIM_DEBUG_EVIDENCE", "").lower() in {"1", "true", "yes"}:
            logging.getLogger("medsim.evidence").info("debrief attempt=%s case=%s questions=%d transcript=%d examinations=%d investigations=%d treatments=%d prescriptions=%d diagnosis=%s rubric=%s", payload.attemptId, payload.caseId, len(asked_ids), len(evidence["transcript"]), len(evidence["examinations"]), len(server_orders), len(evidence["treatments"]), len(evidence["prescriptions"]), bool(evidence["submitted_diagnosis_id"]), ",".join(item["criterionId"] for item in case["evaluation"]["rubric"]))
        system, user = evaluation_prompt(case, evidence, server_orders)
        model_result: dict[str, Any] | None = None
        actual_model: str | None = None
        correlation_id = secrets.token_urlsafe(12)
        error_category: str | None = None
        provider = get_local_llm_provider()
        readiness = None
        try:
            async with asyncio.timeout(3.5):
                readiness = await provider.health()
                if readiness.state != "ready" or readiness.safety_status.startswith("unsafe"):
                    error_category = "low-memory" if readiness.safety_status.startswith("unsafe") else readiness.last_error_category or "evaluation-unavailable"
                else:
                    completion = await provider.structured_completion(StructuredRequest(system=system, user=user, max_tokens=700, temperature=0.0, request_id=correlation_id), EVALUATION_SCHEMA)
                    actual_model = completion.actual_model
                    if validate_model_evaluation(case, completion.value):
                        model_result = completion.value
                    error_category = None if model_result is not None else "invalid-evaluator-schema"
        except TimeoutError:
            error_category = "evaluation-timeout"
        except LLMProviderError as exc:
            error_category = exc.category
            actual_model = exc.actual_model
        except Exception:
            error_category = "evaluation-unavailable"
        result = normalize_evaluation(case, evidence, server_orders, model_result)
        if result["generation"].pop("rejected_model_evidence", False) and error_category is None:
            error_category = "ungrounded-evaluator-evidence"
        result["generation"].update({"error_category": error_category, "provider": readiness.provider if readiness else "deterministic", "configured_model": (readiness.model or None) if readiness else None, "actual_model": actual_model, "request_id": correlation_id})
        result["post_submission"] = copy.deepcopy(case.get("postSubmission"))
        if result["post_submission"] is not None:
            result["post_submission"]["references"] = [copy.deepcopy(LOCAL_AI_REFERENCES[reference_id]) for reference_id in case["evaluation"].get("allowedReferenceIds", []) if reference_id in LOCAL_AI_REFERENCES]
        result["diagnosis_result"] = {"submitted_diagnosis_id": evidence["submitted_diagnosis_id"], "correct_diagnosis_id": case["evaluation"]["correctDiagnosisId"], "diagnosis_was_correct": evidence["submitted_diagnosis_id"] == case["evaluation"]["correctDiagnosisId"]}
        with self.store.lock:
            current = self.store.get(request, payload.attemptId)
            current["evaluationActive"] = False
            current["evaluationResult"] = copy.deepcopy(result)
        return result

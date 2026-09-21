from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from local_ai import SAFE_UNKNOWN_RESPONSE, compose_patient_answer, deterministic_patient_match, exact_patient_answer, patient_system_prompt, sanitize_patient_response
from local_llm import ChatRequest, LLMProviderError, get_local_llm_provider

from ..attempt_store import AttemptStore
from ..schemas import PatientTurnRequest


def sse(value: dict[str, Any]) -> str:
    return "data: " + json.dumps(value, separators=(",", ":")) + "\n\n"


def safe_error_category(exc: Exception) -> tuple[str, str, bool]:
    if isinstance(exc, LLMProviderError):
        return exc.category, exc.safe_message, exc.retryable
    if isinstance(exc, TimeoutError):
        return "response-timeout", "The configured model timed out. Retry the question.", True
    return "model-unavailable", "The configured model is unavailable. Retry later.", True


class PatientDialogueService:
    """Closed-world patient dialogue, provider fallback, and SSE persistence."""

    def __init__(self, store: AttemptStore):
        self.store = store

    async def stream(self, req: PatientTurnRequest, request: Request) -> StreamingResponse:
        correlation_id = req.requestId or secrets.token_urlsafe(12)
        with self.store.lock:
            attempt = self.store.get(request, req.attemptId)
            cached = attempt["patientResponses"].get(correlation_id)
            if cached is not None:
                cached_record = cached if isinstance(cached, dict) else {"text": str(cached), "provenance": "deterministic-authored", "actualModel": None}

                async def cached_generator():
                    text = cached_record["text"]
                    for offset in range(0, len(text), 32):
                        yield sse({"text": text[offset:offset + 32], "correlationId": correlation_id})
                    yield sse({
                        "done": True, "correlationId": correlation_id, "provenance": cached_record.get("provenance"),
                        "actualModel": cached_record.get("actualModel"), "matchConfidence": cached_record.get("matchConfidence", 0.0),
                        "intentId": cached_record.get("intentId"), "matchedSource": cached_record.get("matchedSource"),
                        "answerShownToTrainee": cached_record.get("answerShownToTrainee"), "relevantPerCase": cached_record.get("relevantPerCase"),
                    })
                return StreamingResponse(cached_generator(), media_type="text/event-stream")
            case = attempt["localAiCase"]
            profile = copy.deepcopy(attempt["patientProfile"])
            history = copy.deepcopy(attempt["patientMessages"][-8:])
            authored_value: str | None = None
            matched_question_id: str | None = None
            match_confidence = 0.0
            history_item: dict[str, Any] | None = None
            deterministic_fallback = deterministic_patient_match(case, req.question, is_parent=profile["age"] < 14, profile=profile)
            answer_provenance = "deterministic-authored"
            if req.source == "predefined":
                history_item = next((item for item in case["patient"]["history"] if item["id"] == req.questionId), None)
                authored_value = exact_patient_answer(case, req.questionId)
                if authored_value is None:
                    raise HTTPException(status_code=422, detail="unknown predefined question")
                answer = compose_patient_answer(authored_value, req.question, is_parent=profile["age"] < 14)
                matched_question_id = req.questionId
                match_confidence = 1.0
            elif req.questionId is not None:
                raise HTTPException(status_code=422, detail="typed questions cannot supply a question ID")
            else:
                immediate = deterministic_fallback.provenance == "deterministic-authored" or deterministic_fallback.confidence == 1.0
                answer = deterministic_fallback.response if immediate else None
                if immediate:
                    answer_provenance = deterministic_fallback.provenance
                    authored_value = deterministic_fallback.authored_value
                    matched_question_id = deterministic_fallback.matched_question_id
                    match_confidence = deterministic_fallback.confidence
            if attempt["patientRequestActive"]:
                raise HTTPException(status_code=409, detail="A patient response is already in progress for this encounter.")
            attempt["patientRequestActive"] = True

        async def generator():
            response_text = ""
            provenance = answer_provenance
            actual_model: str | None = None
            attempted_models: list[str] = []
            provider_error_category: str | None = None
            record_authored_value = authored_value
            record_matched_question_id = matched_question_id
            record_match_confidence = match_confidence
            record_intent_id = deterministic_fallback.intent_id
            record_matched_source = deterministic_fallback.matched_source
            try:
                if answer is not None:
                    response_text = answer
                else:
                    provider = get_local_llm_provider()
                    messages = [*history, {"role": "user", "content": req.question.strip()}]
                    try:
                        completion = await provider.complete_chat(ChatRequest(system=patient_system_prompt(case, profile), messages=messages, max_tokens=80, temperature=0.1, request_id=correlation_id))
                        attempted_models = list(completion.attempted_models)
                        actual_model = completion.actual_model
                        response_text = sanitize_patient_response(completion.text, case)
                        provenance = "safe-unknown" if response_text == SAFE_UNKNOWN_RESPONSE else "openrouter"
                    except Exception as exc:
                        provider_error_category, _message, _retryable = safe_error_category(exc)
                        response_text = deterministic_fallback.response
                        provenance = deterministic_fallback.provenance
                        record_authored_value = deterministic_fallback.authored_value
                        record_matched_question_id = deterministic_fallback.matched_question_id
                        record_match_confidence = deterministic_fallback.confidence
                with self.store.lock:
                    current = self.store.get(request, req.attemptId)
                    current["patientMessages"] = [*current["patientMessages"], {"role": "user", "content": req.question.strip()}, {"role": "assistant", "content": response_text}][-16:]
                    current["patientResponses"][correlation_id] = {
                        "text": response_text, "provenance": provenance, "actualModel": actual_model, "attemptedModels": attempted_models,
                        "providerErrorCategory": provider_error_category, "matchConfidence": record_match_confidence,
                        "matchedQuestionId": record_matched_question_id, "authoredValue": record_authored_value,
                        "intentId": record_intent_id, "matchedSource": record_matched_source,
                        "answerShownToTrainee": authored_value if req.source == "predefined" else None,
                        "relevantPerCase": bool(history_item.get("relevant")) if history_item is not None else None,
                    }
                    if len(current["patientResponses"]) > 16:
                        current["patientResponses"].pop(next(iter(current["patientResponses"])))
                    recorded_question_id = req.questionId or record_matched_question_id
                    if recorded_question_id and recorded_question_id not in current["askedQuestionIds"]:
                        current["askedQuestionIds"].append(recorded_question_id)
                    current["transcript"] = [*current["transcript"], {"role": "trainee", "content": req.question.strip(), "timestampIso": str(time.time()), "questionSource": req.source}, {"role": "patient", "content": response_text, "timestampIso": str(time.time()), "questionSource": None}][-256:]
                    if os.environ.get("MEDSIM_DEBUG_EVIDENCE", "").lower() in {"1", "true", "yes"}:
                        logging.getLogger("medsim.evidence").info("patient-turn attempt=%s source=%s question_id=%s intent=%s provenance=%s", req.attemptId, req.source, recorded_question_id, record_intent_id, provenance)
                for offset in range(0, len(response_text), 32):
                    yield sse({"text": response_text[offset:offset + 32], "correlationId": correlation_id})
                    await asyncio.sleep(0)
                yield sse({"done": True, "correlationId": correlation_id, "provenance": provenance, "actualModel": actual_model, "matchConfidence": record_match_confidence, "intentId": record_intent_id, "matchedSource": record_matched_source, "answerShownToTrainee": authored_value if req.source == "predefined" else None, "relevantPerCase": bool(history_item.get("relevant")) if history_item is not None else None})
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                category, _message, _retryable = safe_error_category(exc)
                logging.getLogger("medsim.local_ai").warning("patient inference failed: %s", category)
                yield sse({"text": SAFE_UNKNOWN_RESPONSE, "correlationId": correlation_id})
                yield sse({"done": True, "correlationId": correlation_id, "provenance": "safe-unknown", "actualModel": None})
            finally:
                with self.store.lock:
                    try:
                        self.store.get(request, req.attemptId)["patientRequestActive"] = False
                    except HTTPException:
                        pass

        return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})

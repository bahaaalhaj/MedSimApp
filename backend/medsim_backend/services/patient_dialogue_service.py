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

from local_ai import SAFE_UNKNOWN_RESPONSE, PatientAnswerMatch, compose_patient_answer, deterministic_patient_match, exact_patient_answer, sanitize_patient_response
from local_llm import ChatRequest, LLMProviderError, get_local_llm_provider
from patient_memory import ResolvedTurn, TurnPart, compose_fact, derive_memory, grounding_prompt, resolve_turn, retrieve, unavailable_response, validate_grounded

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
            memory = derive_memory(case, profile)
            retrieval = retrieve(memory, req.question)
            resolved = resolve_turn(memory, req.question, None if attempt.get("evaluationResult") or attempt.get("evaluationActive") else attempt.get("dialogueContext"), is_parent=profile["age"] < 14) if req.source == "typed" else None
            parts: list[dict[str, Any]] = []
            authored_value: str | None = None
            matched_question_id: str | None = None
            match_confidence = 0.0
            history_item: dict[str, Any] | None = None
            deterministic_fallback = deterministic_patient_match(case, req.question, is_parent=profile["age"] < 14, profile=profile)
            matched_facts = ()
            internal_provenance = "predefined-authored"
            answer_provenance = "deterministic-authored"
            if req.source == "predefined":
                history_item = next((item for item in case["patient"]["history"] if item["id"] == req.questionId), None)
                authored_value = exact_patient_answer(case, req.questionId)
                if authored_value is None:
                    raise HTTPException(status_code=422, detail="unknown predefined question")
                answer = compose_patient_answer(authored_value, req.question, is_parent=profile["age"] < 14)
                matched_question_id = req.questionId
                match_confidence = 1.0
                matched_facts = tuple(fact for fact in memory.facts if fact.source_question_id == req.questionId)
            elif req.questionId is not None:
                raise HTTPException(status_code=422, detail="typed questions cannot supply a question ID")
            else:
                if resolved is not None:
                    protected = resolved.parts[0].status == "protected"
                    # Guard each clause independently: one withheld value must
                    # never discard another independently supported clause.
                    resolved = ResolvedTurn(tuple(part if protected or sanitize_patient_response(part.text, case) == part.text
                        else TurnPart(part.intent, unavailable_response(part.intent, is_parent=profile["age"] < 14), reason="protected-value")
                        for part in resolved.parts))
                    parts = [part.audit() for part in resolved.parts]
                    matched_facts = resolved.facts
                    first = matched_facts[0] if matched_facts else None
                    deterministic_fallback = PatientAnswerMatch(resolved.text,
                        "deterministic-authored" if first else "safe-unknown", min(part.confidence for part in resolved.parts),
                        first.authored_value if first else None, first.source_question_id if first else None,
                        resolved.parts[0].intent if len(parts) == 1 else "compound-history",
                        "safety-policy" if protected else "patient-profile" if first and first.fact_id.startswith("profile:") else "authored-history" if first else "not-documented")
                    internal_provenance = "protected-refusal" if protected else "deterministic-fact" if first and first.fact_id.startswith("profile:") else "deterministic-authored" if first else "safe-unknown"
                elif deterministic_fallback.intent_id and deterministic_fallback.intent_id.startswith("profile-"):
                    internal_provenance = "deterministic-fact"
                    field = {"profile-name": "displayName", "profile-age": "age", "profile-gender": "gender", "profile-chief-complaint": "chiefComplaint"}.get(deterministic_fallback.intent_id)
                    matched_facts = tuple(fact for fact in memory.facts if fact.fact_id == f"profile:{field}")
                elif retrieval.immediate and retrieval.candidates:
                    fact = retrieval.candidates[0]
                    text = compose_fact(fact, req.question, is_parent=profile["age"] < 14)
                    safe_text = sanitize_patient_response(text, case)
                    if safe_text == text:
                        matched_facts = (fact,)
                        deterministic_fallback = PatientAnswerMatch(text, "deterministic-authored", retrieval.confidence,
                            fact.authored_value, fact.source_question_id, f"history-{fact.source_question_id}", "authored-history")
                        internal_provenance = "deterministic-authored"
                    else:
                        deterministic_fallback = PatientAnswerMatch(SAFE_UNKNOWN_RESPONSE, "safe-unknown", 1.0, intent_id="protected-value", matched_source="safe-unknown")
                        internal_provenance = "safe-unknown"
                else:
                    deterministic_fallback = PatientAnswerMatch(SAFE_UNKNOWN_RESPONSE, "safe-unknown", retrieval.confidence,
                        intent_id=retrieval.reason, matched_source="safe-unknown")
                    internal_provenance = "safe-unknown"
                immediate = resolved is not None or retrieval.immediate or internal_provenance == "deterministic-fact"
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
            record_facts = matched_facts
            record_internal_provenance = internal_provenance
            validation_result = "deterministic"
            fallback_reason: str | None = ",".join(dict.fromkeys(part["fallbackReason"] for part in parts if part["fallbackReason"])) or None
            provider_latency_ms: float | None = None
            try:
                if answer is not None:
                    response_text = answer
                else:
                    provider = get_local_llm_provider()
                    # Do not send transcript, whole history, evaluation, or other cases.
                    # Filter even candidate text through the existing leak guard.
                    candidates = tuple(fact for fact in retrieval.candidates
                        if sanitize_patient_response(compose_fact(fact, req.question, is_parent=profile["age"] < 14), case)
                        == compose_fact(fact, req.question, is_parent=profile["age"] < 14))
                    messages = [{"role": "user", "content": req.question.strip()}]
                    started = time.perf_counter()
                    try:
                        if not candidates:
                            raise ValueError("no safe candidates")
                        completion = await provider.complete_chat(ChatRequest(system=grounding_prompt(candidates, req.question, is_parent=profile["age"] < 14), messages=messages, max_tokens=80, temperature=0.1, request_id=correlation_id))
                        attempted_models = list(completion.attempted_models)
                        actual_model = completion.actual_model
                        grounded, selected, validation_result = validate_grounded(completion.text, memory, candidates, req.question, is_parent=profile["age"] < 14)
                        if grounded is not None and sanitize_patient_response(grounded, case) == grounded:
                            response_text = grounded
                            provenance = "openrouter"
                            record_internal_provenance = "openrouter-grounded"
                            record_facts = selected
                            record_authored_value = selected[0].authored_value
                            record_matched_question_id = selected[0].source_question_id
                            record_match_confidence = retrieval.confidence
                            record_intent_id = "grounded-history"
                            record_matched_source = "authored-history"
                        else:
                            response_text = deterministic_fallback.response
                            provenance = deterministic_fallback.provenance
                            fallback_reason = validation_result if grounded is None else "protected-output"
                    except Exception as exc:
                        provider_error_category, _message, _retryable = safe_error_category(exc)
                        response_text = deterministic_fallback.response
                        provenance = deterministic_fallback.provenance
                        record_authored_value = deterministic_fallback.authored_value
                        record_matched_question_id = deterministic_fallback.matched_question_id
                        record_match_confidence = deterministic_fallback.confidence
                        fallback_reason = provider_error_category
                        validation_result = "provider-failed"
                    finally:
                        provider_latency_ms = round((time.perf_counter() - started) * 1000, 3)
                with self.store.lock:
                    current = self.store.get(request, req.attemptId)
                    current["patientMessages"] = [*current["patientMessages"], {"role": "user", "content": req.question.strip()}, {"role": "assistant", "content": response_text}][-16:]
                    current["patientResponses"][correlation_id] = {
                        "text": response_text, "provenance": provenance, "actualModel": actual_model, "attemptedModels": attempted_models,
                        "providerErrorCategory": provider_error_category, "matchConfidence": record_match_confidence,
                        "matchedQuestionId": record_matched_question_id, "authoredValue": record_authored_value,
                        "intentId": record_intent_id, "matchedSource": record_matched_source,
                        # Internal only: public SSE retains its existing fields/enums.
                        "internalProvenance": record_internal_provenance,
                        "matchedFactIds": [fact.fact_id for fact in record_facts],
                        "caseId": memory.case_id, "caseVersion": memory.case_version,
                        "memorySchemaVersion": memory.schema_version,
                        "validationResult": validation_result, "fallbackReason": fallback_reason,
                        "parts": parts,
                        "providerLatencyMs": provider_latency_ms,
                        "answerShownToTrainee": authored_value if req.source == "predefined" else None,
                        "relevantPerCase": bool(history_item.get("relevant")) if history_item is not None else None,
                    }
                    if len(current["patientResponses"]) > 16:
                        current["patientResponses"].pop(next(iter(current["patientResponses"])))
                    # Model selection is dialogue assistance, never scoring authority.
                    # Keep its support ID internally without awarding an authored action.
                    recorded_question_id = req.questionId or (record_matched_question_id if provenance != "openrouter" else None)
                    if recorded_question_id and recorded_question_id not in current["askedQuestionIds"]:
                        current["askedQuestionIds"].append(recorded_question_id)
                    if record_facts and not current.get("evaluationResult") and not current.get("evaluationActive"):
                        clinical_facts = tuple(f for f in record_facts if f.category != "identity")
                        if clinical_facts:
                            current["dialogueContext"] = {"caseId": memory.case_id, "caseVersion": memory.case_version,
                                "factIds": [f.fact_id for f in clinical_facts[:4]],
                                "domains": sorted({d for f in clinical_facts[:4] for d in f.domains})}
                    elif resolved is not None:
                        current.pop("dialogueContext", None)
                    current["transcript"] = [*current["transcript"], {"role": "trainee", "content": req.question.strip(), "timestampIso": str(time.time()), "questionSource": req.source}, {
                        "role": "patient", "content": response_text, "timestampIso": str(time.time()), "questionSource": None,
                        # Retain audit support with the existing bounded transcript,
                        # even after the shorter response replay cache evicts a turn.
                        "dialogueProvenance": {key: current["patientResponses"][correlation_id][key] for key in (
                            "internalProvenance", "matchedFactIds", "matchedQuestionId", "authoredValue",
                            "caseId", "caseVersion", "memorySchemaVersion", "actualModel",
                            "providerLatencyMs", "validationResult", "fallbackReason", "matchConfidence", "parts",
                        )},
                    }][-256:]
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

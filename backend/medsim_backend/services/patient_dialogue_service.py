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
from local_llm import ChatRequest, LLMProviderError, get_local_llm_provider, settings as llm_settings
from patient_memory import ResolvedTurn, TurnPart, compose_fact, derive_memory, grounding_prompt, resolve_turn, retrieve, unavailable_response, validate_grounded
from patient_interpretation import enabled as semantic_enabled, interpretation_prompt, validate_interpretation

from ..attempt_store import AttemptStore
from ..schemas import PatientTurnRequest
from ..diagnostic_logging import log_event

def semantic_timeout_seconds() -> float:
    configured = llm_settings()
    return configured.local_interpretation_timeout_seconds if configured.provider == "llama_cpp" else configured.hosted_semantic_timeout_seconds

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
            dialogue_context = None if attempt.get("evaluationResult") or attempt.get("evaluationActive") else copy.deepcopy(attempt.get("dialogueContext"))
            resolved = resolve_turn(memory, req.question, dialogue_context, is_parent=profile["age"] < 14) if req.source == "typed" else None
            use_semantic = False
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
                    resolved = ResolvedTurn(tuple(part if protected or sanitize_patient_response(part.text, case, authored_response=part.text if len(part.facts) == 1 and part.text == compose_fact(part.facts[0], req.question, is_parent=profile["age"] < 14) else None) == part.text
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
                    safe_text = sanitize_patient_response(text, case, authored_response=text)
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
                # Missing or incomplete lexical retrieval is not authoritative
                # absence: interpret against ALL patient-safe facts of this case.
                incomplete = not matched_facts or not retrieval.immediate or (resolved is not None and any(part.reason for part in resolved.parts))
                known_absence = resolved is not None and all(part.intent == 'patient-measurement' and part.reason == 'patient-knowledge-unavailable' for part in resolved.parts)
                use_semantic = semantic_enabled() and internal_provenance not in {"protected-refusal", "deterministic-fact"} and incomplete and not known_absence
                if use_semantic:
                    answer = None
            if attempt["patientRequestActive"]:
                raise HTTPException(status_code=409, detail="A patient response is already in progress for this encounter.")
            attempt["patientRequestActive"] = True

        async def generator():
            response_text = ""
            provenance = answer_provenance
            actual_model: str | None = None
            attempted_models: list[str] = []
            provider_error_category: str | None = None
            provider_failure: Exception | None = None
            record_authored_value = authored_value
            record_matched_question_id = matched_question_id
            record_match_confidence = match_confidence
            record_intent_id = deterministic_fallback.intent_id
            record_matched_source = deterministic_fallback.matched_source
            record_facts = matched_facts
            record_internal_provenance = internal_provenance
            record_parts = list(parts)
            validation_result = "deterministic"
            fallback_reason: str | None = ",".join(dict.fromkeys(part["fallbackReason"] for part in parts if part["fallbackReason"])) or None
            provider_latency_ms: float | None = None
            failure_message = "The patient response service is unavailable. Your question was not answered. Please retry."
            failure_retryable = True
            try:
                if answer is not None:
                    response_text = answer
                elif use_semantic:
                    started = time.perf_counter()
                    try:
                        system = interpretation_prompt(memory, dialogue_context)
                        provider = get_local_llm_provider()
                        # The wall-clock budget also includes waiting on the
                        # shared provider gate. Never chain a second model.
                        completion = await asyncio.wait_for(provider.complete_chat(ChatRequest(
                            system=system, messages=[{"role": "user", "content": req.question.strip()}],
                            max_tokens=200, temperature=0.0, request_id=correlation_id,
                            task="patient-interpretation")), timeout=semantic_timeout_seconds())
                        attempted_models = list(completion.attempted_models)
                        actual_model = completion.actual_model
                        interpreted = validate_interpretation(completion.text, memory, case, is_parent=profile["age"] < 14)
                        validation_result = interpreted.reason
                        if interpreted.turn is None:
                            raise LLMProviderError("model-unavailable", "The patient response could not be validated. Your question was not answered. Please retry.", True)
                        else:
                            turn = interpreted.turn
                            record_parts = [part.audit() for part in turn.parts]
                            response_text = turn.text
                            record_facts = turn.facts
                            record_authored_value = record_facts[0].authored_value if record_facts else None
                            record_matched_question_id = record_facts[0].source_question_id if record_facts else None
                            record_match_confidence = 0.0  # Semantic relevance is not a calibrated probability.
                            provenance = "openrouter" if record_facts else "safe-unknown"
                            record_internal_provenance = "openrouter-interpreted" if record_facts else "semantic-clarification" if validation_result == "valid-semantic-clarify" else "semantic-unknown"
                            record_intent_id = "semantic-history" if record_facts else turn.parts[0].intent
                            record_matched_source = "authored-history" if record_facts else "safe-unknown"
                            fallback_reason = "partial-history" if any(part.reason == "partial-history" for part in turn.parts) else None
                    except Exception as exc:
                        provider_failure = exc
                        provider_error_category, _message, failure_retryable = safe_error_category(exc)
                        if provider_error_category == "response-timeout":
                            failure_message = "The patient response service timed out. Your question was not answered. Please retry."
                        elif provider_error_category == "rate-limited":
                            failure_message = "The patient response service is rate limited. Your question was not answered. Wait before retrying."
                        fallback_reason = provider_error_category
                        if validation_result == "deterministic":
                            validation_result = "semantic-provider-failed"
                    finally:
                        provider_latency_ms = round((time.perf_counter() - started) * 1000, 3)
                else:
                    provider = get_local_llm_provider()
                    # Do not send transcript, whole history, evaluation, or other cases.
                    # Filter even candidate text through the existing leak guard.
                    candidates = tuple(fact for fact in retrieval.candidates
                        if sanitize_patient_response(compose_fact(fact, req.question, is_parent=profile["age"] < 14), case, authored_response=compose_fact(fact, req.question, is_parent=profile["age"] < 14))
                        == compose_fact(fact, req.question, is_parent=profile["age"] < 14))
                    messages = [{"role": "user", "content": req.question.strip()}]
                    started = time.perf_counter()
                    try:
                        if not candidates:
                            # No request was needed: this is actual unavailable
                            # case information, not a failed provider invocation.
                            response_text = deterministic_fallback.response
                            provenance = deterministic_fallback.provenance
                        else:
                            completion = await provider.complete_chat(ChatRequest(system=grounding_prompt(candidates, req.question, is_parent=profile["age"] < 14), messages=messages, max_tokens=80, temperature=0.1, request_id=correlation_id))
                            attempted_models = list(completion.attempted_models)
                            actual_model = completion.actual_model
                            grounded, selected, validation_result = validate_grounded(completion.text, memory, candidates, req.question, is_parent=profile["age"] < 14)
                            if grounded is None or sanitize_patient_response(grounded, case, authored_response=compose_fact(selected[0], req.question, is_parent=profile["age"] < 14)) != grounded:
                                raise LLMProviderError("model-unavailable", "The patient response could not be validated. Please retry.", True)
                            response_text = grounded
                            provenance = "openrouter"
                            record_internal_provenance = "openrouter-grounded"
                            record_facts = selected
                            record_authored_value = selected[0].authored_value
                            record_matched_question_id = selected[0].source_question_id
                            record_match_confidence = retrieval.confidence
                            record_intent_id = "grounded-history"
                            record_matched_source = "authored-history"
                    except Exception as exc:
                        provider_failure = exc
                        provider_error_category, _message, failure_retryable = safe_error_category(exc)
                        fallback_reason = provider_error_category
                        validation_result = "provider-failed"
                    finally:
                        provider_latency_ms = round((time.perf_counter() - started) * 1000, 3)
                if provider_error_category:
                    log_event('patient-response-failed', request_id=correlation_id,
                              category=provider_error_category, error=provider_failure,
                              status=getattr(provider_failure, 'status_code', None),
                              retryable=failure_retryable, latency_ms=provider_latency_ms,
                              validation=validation_result)
                    # Operational failures are NOT patient speech or grading
                    # evidence. Keep a bounded private diagnostic, not a replayed
                    # clinical answer; the same request ID may be retried safely.
                    with self.store.lock:
                        current = self.store.get(request, req.attemptId)
                        failures = current.setdefault("patientFailures", {})
                        failures[correlation_id] = {"category": provider_error_category,
                            "validationResult": validation_result, "providerLatencyMs": provider_latency_ms,
                            "retryable": failure_retryable}
                        if len(failures) > 16:
                            failures.pop(next(iter(failures)))
                    yield sse({"error": failure_message, "category": provider_error_category,
                               "retryable": failure_retryable, "correlationId": correlation_id})
                    return
                with self.store.lock:
                    current = self.store.get(request, req.attemptId)
                    current.get("patientFailures", {}).pop(correlation_id, None)
                    current["patientMessages"] = [*current["patientMessages"], {"role": "user", "content": req.question.strip()}, {"role": "assistant", "content": response_text}][-16:]
                    current["patientResponses"][correlation_id] = {
                        "text": response_text, "provenance": provenance, "actualModel": actual_model, "attemptedModels": attempted_models,
                        "providerErrorCategory": provider_error_category, "matchConfidence": record_match_confidence,
                        "matchedQuestionId": record_matched_question_id, "authoredValue": record_authored_value,
                        "intentId": record_intent_id, "matchedSource": record_matched_source,
                        # Internal only: public SSE retains its existing fields/enums.
                        "internalProvenance": record_internal_provenance,
                        "matchedFactIds": [fact.fact_id for fact in record_facts],
                        "factReviewRequirements": {fact.fact_id: fact.review_status for fact in record_facts},
                        "caseId": memory.case_id, "caseVersion": memory.case_version,
                        "memorySchemaVersion": memory.schema_version,
                        "validationResult": validation_result, "fallbackReason": fallback_reason,
                        "parts": record_parts,
                        "providerLatencyMs": provider_latency_ms,
                        "answerShownToTrainee": authored_value if req.source == "predefined" else None,
                        "relevantPerCase": bool(history_item.get("relevant")) if history_item is not None else None,
                    }
                    if len(current["patientResponses"]) > 16:
                        current["patientResponses"].pop(next(iter(current["patientResponses"])))
                    # Model selection is dialogue assistance, never scoring authority.
                    # Keep its support ID internally without awarding an authored action.
                    recorded_question_id = req.questionId or (record_matched_question_id if provenance != "openrouter" else None)
                    if recorded_question_id and any(row["id"] == recorded_question_id and not row.get("scoreable", True) for row in case["patient"]["history"]):
                        recorded_question_id = None
                    if recorded_question_id and recorded_question_id not in current["askedQuestionIds"]:
                        current["askedQuestionIds"].append(recorded_question_id)
                    if record_facts and not current.get("evaluationResult") and not current.get("evaluationActive"):
                        clinical_facts = tuple(f for f in record_facts if f.category != "identity")
                        if clinical_facts:
                            current["dialogueContext"] = {"caseId": memory.case_id, "caseVersion": memory.case_version,
                                "factIds": [f.fact_id for f in clinical_facts[:4]],
                                "domains": sorted({d for f in clinical_facts[:4] for d in f.domains})}
                    elif req.source == "typed":
                        current.pop("dialogueContext", None)
                    if req.source == 'predefined' and req.questionId and authored_value is not None:
                        current.setdefault('visibleAnswers', {})[req.questionId] = {
                            'answer': authored_value, 'relevant': bool(history_item.get('relevant')) if history_item else False,
                        }
                    current["transcript"] = [*current["transcript"], {"role": "trainee", "content": req.question.strip(), "timestampIso": str(time.time()), "questionSource": req.source}, {
                        "role": "patient", "content": response_text, "timestampIso": str(time.time()), "questionSource": None,
                        # Retain audit support with the existing bounded transcript,
                        # even after the shorter response replay cache evicts a turn.
                        "dialogueProvenance": {key: current["patientResponses"][correlation_id][key] for key in (
                            "internalProvenance", "matchedFactIds", "factReviewRequirements", "matchedQuestionId", "authoredValue",
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
                log_event('patient-response-cancelled', level=logging.INFO,
                          request_id=correlation_id, category='client-disconnected')
                raise
            except Exception as exc:
                category, _message, _retryable = safe_error_category(exc)
                log_event('patient-response-failed', level=logging.ERROR, request_id=correlation_id,
                          category=category, error=exc, status=getattr(exc, 'status_code', None), retryable=_retryable)
                yield sse({"error": "The patient response service is unavailable. Your question was not answered. Please retry.",
                           "category": category, "retryable": _retryable, "correlationId": correlation_id})
            finally:
                with self.store.lock:
                    try:
                        self.store.get(request, req.attemptId)["patientRequestActive"] = False
                    except HTTPException:
                        pass

        return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})

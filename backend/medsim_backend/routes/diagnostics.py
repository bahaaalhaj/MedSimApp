from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

from local_llm import get_local_llm_provider, health_dict, settings as llm_settings
from tts import TTSConfigurationError, TTSProviderError, TTSRequest, get_tts_manager

from ..schemas import PatientTTSRequestBody


def register_diagnostics_routes(
    app: FastAPI,
    get_attempt: Callable[[Request, str], dict[str, Any]],
    lock: Any,
    tts_settings: Any,
) -> None:
    @app.get("/health")
    async def health():
        try:
            tts_status = get_tts_manager().health()
        except TTSConfigurationError as exc:
            tts_status = {"configured": False, "error": str(exc)}
        llm = health_dict(await get_local_llm_provider().health())
        return {
            "ok": True,
            "patient_tts": tts_status,
            "local_ai": llm,
            "evaluation_mode": llm_settings().evaluation_mode,
            "patient_ready": llm["state"] == "ready" and not llm["safety_status"].startswith("unsafe"),
            "evaluator_ready": True,
            "last_safe_error_category": llm["last_error_category"],
        }

    @app.post("/tts/synthesize")
    async def synthesize_patient_speech(req: PatientTTSRequestBody, request: Request):
        if not req.text.strip() or len(req.text) > 2000:
            raise HTTPException(status_code=422, detail="Patient text must contain 1 to 2000 characters")
        if req.speed is not None and not 0.7 <= req.speed <= 1.3:
            raise HTTPException(status_code=422, detail="speed must be between 0.7 and 1.3")
        if req.language != tts_settings.language:
            raise HTTPException(status_code=422, detail="language must match server PATIENT_TTS_LANGUAGE")
        with lock:
            attempt = get_attempt(request, req.attemptId)
            if req.caseId != attempt["caseId"] or req.caseVersion != attempt["caseVersion"]:
                raise HTTPException(status_code=409, detail="TTS attempt provenance mismatch")
            profile = attempt["patientProfile"]
            gender = str(profile["gender"])
            is_pediatric = int(profile["age"]) < 14
        started = time.perf_counter()
        try:
            manager = get_tts_manager()
            result = await manager.synthesize(TTSRequest(
                text=req.text, case_id=req.caseId, gender=gender,
                is_pediatric=is_pediatric, speed=req.speed, language=req.language,
                case_version=req.caseVersion, is_opening_greeting=req.isOpeningGreeting,
                cacheable=req.cacheable, request_id=req.requestId,
            ))
        except (TTSConfigurationError, TTSProviderError) as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return Response(
            content=result.audio,
            media_type=result.media_type,
            headers={
                "Cache-Control": "no-store",
                "X-Patient-TTS-Provider": result.provider,
                "X-Patient-TTS-Voice": result.voice,
                "X-Patient-TTS-Cache": "hit" if result.cache_hit else "miss",
                "X-Patient-TTS-Source": result.provider,
                "X-Patient-TTS-Initialization-Count": str(getattr(manager._provider, "load_count", 0)),
                "Server-Timing": f"tts;dur={(time.perf_counter() - started) * 1000:.1f}",
                "X-Patient-TTS-Normalized": result.synthesized_text.encode("ascii", "ignore").decode("ascii")[:500],
            },
        )

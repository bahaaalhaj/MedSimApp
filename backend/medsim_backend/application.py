from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import RuntimeSettings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Authentication and initial rendering must not compete with torch/Kokoro.
    # Model loading remains deferred to the request paths that need it.
    yield


def create_application(settings: RuntimeSettings, limiter: Limiter) -> FastAPI:
    """Build the compatibility application without eagerly loading providers."""
    app = FastAPI(title="MedSim Backend", version="0.2.0", lifespan=lifespan)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.middleware("http")
    async def development_timing(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        if request.headers.get("origin", "") in settings.dev_origins or os.environ.get("MEDSIM_DEBUG_TIMING", "").lower() in {"1", "true", "yes"}:
            app_timing = f"app;dur={(time.perf_counter() - started) * 1000:.1f}"
            response.headers["Server-Timing"] = ", ".join(filter(None, [response.headers.get("Server-Timing"), app_timing]))
            response.headers["X-MedSim-Request-Id"] = request.headers.get("x-request-id", "")[:100]
        return response

    @app.middleware("http")
    async def require_shared_secret(request: Request, call_next):
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)
        origin = request.headers.get("origin", "")
        if origin in settings.dev_origins:
            return await call_next(request)
        referer = request.headers.get("referer", "")
        if any(referer.startswith(origin_value + "/") for origin_value in settings.dev_origins):
            return await call_next(request)
        if settings.shared_secret and request.headers.get("x-medsim-auth") == settings.shared_secret:
            return await call_next(request)
        return JSONResponse({"detail": "unauthorized"}, status_code=401)

    # Last-added CORS remains outermost, preserving preflight/auth ordering.
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    return app

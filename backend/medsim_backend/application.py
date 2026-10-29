from __future__ import annotations

import os
import asyncio
import time
import logging
import hmac
import ipaddress
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import RuntimeSettings
from .guest_session import GuestSessionMiddleware
from .diagnostic_logging import DiagnosticMiddleware, background_exception_handler, configure_terminal_logging, log_event
from tts import TTSConfigurationError, get_tts_manager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Import/authentication stay lightweight. Only the post-start background
    # task may load a verified local model; it never downloads missing weights.
    task = None
    provider = None
    loop = asyncio.get_running_loop()
    previous_handler = loop.get_exception_handler()
    loop.set_exception_handler(background_exception_handler)
    try:
        from local_llm import new_application_provider
        existing = getattr(_app.state, 'llm_provider', None) if _app is not None else None
        if existing is not None and existing._owner_loop is not None:
            raise RuntimeError('This application already has an active provider lifecycle')
        factory = getattr(_app.state, 'provider_factory', None) if _app is not None else None
        provider = (factory or new_application_provider)()
        async with provider.lifespan():
            if _app is not None:
                _app.state.llm_provider = provider
            try:
                task = get_tts_manager().start_background_preload()
            except TTSConfigurationError as exc:
                log_event('tts-preload-failed', category='tts-configuration-invalid', error=exc)
            log_event('backend-started', level=logging.INFO)
            yield
    except Exception as exc:
        log_event('backend-lifecycle-failed', level=logging.ERROR, category='application-error', error=exc)
        raise
    finally:
        try:
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        finally:
            if _app is not None and getattr(_app.state, 'llm_provider', None) is provider:
                _app.state.llm_provider = None
            loop.set_exception_handler(previous_handler)
            log_event('backend-stopped', level=logging.INFO)


class ApplicationProviderMiddleware:
    def __init__(self, app, owner):
        self.app, self.owner = app, owner

    async def __call__(self, scope, receive, send):
        from local_llm import bind_application_provider
        provider = getattr(self.owner.state, 'llm_provider', None)
        with bind_application_provider(provider):
            await self.app(scope, receive, send)


def create_application(settings: RuntimeSettings, limiter: Limiter, *, provider_factory=None) -> FastAPI:
    """Build the compatibility application without eagerly loading providers."""
    configure_terminal_logging()
    app = FastAPI(title="MedSim Backend", version="0.2.0", lifespan=lifespan,
                  docs_url=None if settings.pilot_origin else "/docs",
                  redoc_url=None if settings.pilot_origin else "/redoc",
                  openapi_url=None if settings.pilot_origin else "/openapi.json")
    app.state.limiter = limiter
    app.state.provider_factory = provider_factory
    app.add_middleware(ApplicationProviderMiddleware, owner=app)
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
        # Pilot ingress is validated by the outer ASGI boundary. API/session
        # ownership and CSRF checks still run on the existing routes.
        if settings.pilot_origin:
            return await call_next(request)
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)
        origin = request.headers.get("origin", "")
        referer = request.headers.get("referer", "")
        try:
            local_peer = bool(request.client and ipaddress.ip_address(request.client.host).is_loopback)
        except ValueError:
            local_peer = False
        if settings.development_access and local_peer and (origin in settings.dev_origins or
                any(referer.startswith(value + "/") for value in settings.dev_origins)):
            return await call_next(request)
        if settings.shared_secret and hmac.compare_digest(request.headers.get("x-medsim-auth", "").encode(), settings.shared_secret.encode()):
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
    # Pure observer outside existing CORS/auth/rate-limit order; no response edits.
    app.add_middleware(DiagnosticMiddleware)
    from auth_system import AuthSettings
    app.add_middleware(GuestSessionMiddleware, secure=AuthSettings.from_env().cookie_secure)
    if settings.pilot_origin:
        from .pilot import PilotBoundary
        app.add_middleware(PilotBoundary, origin=settings.pilot_origin)
    return app

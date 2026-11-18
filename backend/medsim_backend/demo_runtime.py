"""Explicit guest-only factory. Never import the ordinary runtime/auth/TTS path."""
import os
import re
from dataclasses import dataclass
from types import SimpleNamespace

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from local_ai import LOCAL_AI_CASES
from local_llm import LocalLLMSettings, OpenRouterLLMProvider
from .application import create_application
from .config import RuntimeSettings, pilot_origin
from .demo_provider import DemoOwnerMiddleware, DemoProvider
from .manifests import _load_investigation_cases, _load_safe_curated_cases
from .redis_store import RedisAttemptStore, UpstashCommands
from .routes.attempts import register_attempt_routes
from .routes.catalogue import register_catalogue_routes
from .routes.evaluation import register_evaluation_routes
from .routes.investigations import register_investigation_routes
from .routes.patient_dialogue import register_patient_dialogue_routes
from .services.attempt_service import AttemptService
from .services.evaluation_service import EvaluationService
from .services.investigation_service import InvestigationService
from .services.patient_dialogue_service import PatientDialogueService

MODE = 'vercel-guest-demo'
PINNED_MODEL = 'nvidia/nemotron-3.5-super-vl:free'


@dataclass
class DemoRuntime:
    app: object
    attempt_store: RedisAttemptStore
    attempts: AttemptService
    dialogue: PatientDialogueService
    evaluation: EvaluationService


def create_demo_runtime(*, commands=None, provider_factory=None) -> DemoRuntime:
    if os.environ.get('MEDSIM_DEPLOYMENT_MODE') != MODE:
        raise ValueError('Guest demo requires explicit MEDSIM_DEPLOYMENT_MODE=vercel-guest-demo')
    # Hex encoding is unambiguous; require 32 random bytes, never echo the value.
    signing = os.environ.get('MEDSIM_DEMO_GUEST_SIGNING_SECRET', '')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', signing) or len(set(signing.lower())) < 8:
        raise ValueError('MEDSIM_DEMO_GUEST_SIGNING_SECRET must contain 32 cryptographically random bytes encoded as hex')
    origins = [pilot_origin(item.strip()) for item in os.environ.get('MEDSIM_DEMO_ORIGINS', '').split(',') if item.strip()]
    if not origins:
        raise ValueError('MEDSIM_DEMO_ORIGINS requires exact HTTPS deployment origins')
    namespace = os.environ.get('MEDSIM_DEMO_NAMESPACE', '')
    store = RedisAttemptStore(commands or UpstashCommands(os.environ.get('UPSTASH_REDIS_REST_URL', ''),
                                                         os.environ.get('UPSTASH_REDIS_REST_TOKEN', '')), namespace)
    if provider_factory is None:
        configured = LocalLLMSettings.from_env()
        if (configured.provider != 'openrouter' or configured.patient_model != PINNED_MODEL or not configured.api_key
                or configured.fallback_models or configured.enable_pro_fallback or configured.local_llm_enabled
                or configured.base_url != 'https://openrouter.ai/api/v1'):
            raise ValueError('Demo requires the pinned free OpenRouter model, server key, and no fallback/local provider')
        from dataclasses import replace
        configured = replace(configured, patient_timeout_seconds=7.8, hosted_semantic_timeout_seconds=8.0, max_retries=0)
        configured.validate()
        def provider_factory():
            return DemoProvider(OpenRouterLLMProvider(configured), store)
    settings = RuntimeSettings('', origins, set(), demo=True, guest_signing_key=bytes.fromhex(signing))
    # Process-local IP middleware is deliberately NOT advertised as a global
    # quota. Every provider completion also passes Redis shared admission.
    app = create_application(settings, Limiter(key_func=get_remote_address), provider_factory=provider_factory)
    # Insert inside GuestSessionMiddleware, so only validated cookie identity is used.
    from .guest_session import GuestSessionMiddleware
    index = next(i for i, item in enumerate(app.user_middleware) if item.cls is GuestSessionMiddleware)
    from starlette.middleware import Middleware
    app.user_middleware.insert(index + 1, Middleware(DemoOwnerMiddleware))
    cases = _load_investigation_cases()
    attempts = AttemptService(store, cases, LOCAL_AI_CASES, SimpleNamespace(provider='disabled'))
    investigations = InvestigationService(store, cases)
    dialogue = PatientDialogueService(store, semantic_timeout=8.0)
    evaluation = EvaluationService(store, cases, investigations)
    register_attempt_routes(app, attempts)
    register_investigation_routes(app, investigations)
    register_catalogue_routes(app, _load_safe_curated_cases())
    register_patient_dialogue_routes(app, dialogue)
    register_evaluation_routes(app, evaluation)

    @app.get('/api/capabilities')
    def capabilities(request: Request):
        # Fail closed on storage failure even before a learner starts a case.
        store.command('PING')
        return {'deploymentMode': MODE, 'accounts': False, 'audio': False,
                'guestId': 'demo_' + request.state.guest_id}

    @app.get('/health')
    def health():
        store.command('PING')
        return {'status': 'ok', 'deploymentMode': MODE, 'audio': False}

    return DemoRuntime(app, store, attempts, dialogue, evaluation)

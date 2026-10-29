# Hosted-default and optional local AI architecture

## Provider decision

MedSim defaults to a backend-only OpenRouter provider and keeps local llama.cpp as an explicit offline option. OpenRouter receives only synthetic patient-safe facts or bounded learner evidence; it never receives browser credentials, unrelated case-bank data, internal paths, or real patient data. Kokoro remains local and patient text remains authoritative.

The historical 2026-09-15 configuration selected Nex Mini/Pro; those IDs were absent from the catalogue on 2026-10-16. The requested `google/gemma-4-26b-a4b-it` ID exists but is paid. Its separate `:free` variant was verified at zero prompt/completion prices, but live patient requests encountered upstream Google AI Studio rate limits. The current explicit primary is `nvidia/nemotron-3.5-super-vl:free`, also catalogue-verified at zero prices, with optional reasoning and structured outputs. Actual authenticated inference returned zero cost and zero reasoning tokens, but this does not prove reliable live dialogue under the existing deadline. See `development/openrouter-hosted-validation.md` for measured results. There is no configured fallback or automatic model chain. These are runtime observations, not clinical approval or a guarantee of future availability.

Free availability varies. OpenRouter documents 50 free-model requests per day for accounts with less than 10 purchased credits and 1,000 per day after that threshold. Internet connectivity and provider capacity are required. Configure the API key's lowest available spending limit and model allowlist in the OpenRouter dashboard even though MedSim also enforces `:free`.

## Trust and scoring boundaries

Patient prompts are built by FastAPI from a server-only manifest. The browser submits an owner-bound attempt ID and question metadata. The server bounds input/history/output, treats learner text as untrusted, buffers and sanitizes output before SSE emission, and does not send diagnosis or rubric truth to the patient model. The opening greeting is deterministic and does not consume inference quota.

Evaluation accepts encounter evidence only. FastAPI restores the authoritative case/version, rubric, immutable weights, diagnosis, critical rules, guideline allowlist, and server-recorded orders. The model may classify semantic evidence and draft feedback. Positive verdicts must cite recorded evidence. Server code owns arithmetic, deterministic diagnosis/prescription facts, critical failures, and missing-evidence behavior. Invalid or unavailable model output uses deterministic fallback.

One patient request may be active per attempt. Completed patient requests are idempotent by correlation ID. One evaluation response is generated and cached per attempt. Each approved model is attempted at most once; only the non-inference model-catalogue check uses bounded exponential backoff.

Each running FastAPI application lifecycle owns its provider, inference gate and lazy OpenRouter HTTP connection pool. It retains at most one connection with 30-second idle expiry, preserves per-request deadlines and verified HTTPS, rejects provider cookies, and cancels pending provider work before closing the client on shutdown. Standalone calls without an explicit provider lifespan retain short-lived clients; a pool never crosses event loops or application lifecycles. There are no new completion retries or inference warmups. See the [connection study and ownership report](development/hosted-connection-study-20261029.md) for measured findings, stale-connection behavior, limitations and the next separately authorized live acceptance test.

## Configuration

```env
MEDSIM_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
OPENROUTER_FALLBACK_MODELS=
OPENROUTER_PRO_FALLBACK_ENABLED=false
OPENROUTER_TIMEOUT_SECONDS=7
OPENROUTER_PATIENT_TIMEOUT_SECONDS=3
OPENROUTER_SEMANTIC_TIMEOUT_SECONDS=3.2
OPENROUTER_MAX_RETRIES=0
OPENROUTER_ALLOW_PAID_MODELS=false
MEDSIM_LOCAL_LLM_ENABLED=false
MEDSIM_SEMANTIC_DIALOGUE_ENABLED=true

# Optional offline settings
MEDSIM_LLM_BASE_URL=http://127.0.0.1:8080/v1
MEDSIM_LLM_PATIENT_MODEL=qwen3-local
MEDSIM_LLM_MODEL_PATH=
MEDSIM_LLM_CONTEXT_SIZE=4096
MEDSIM_LLM_MAX_CONCURRENCY=1
MEDSIM_LLM_THINKING=false
MEDSIM_LLM_TIMEOUT_SECONDS=60
MEDSIM_LLM_GPU_OFFLOAD=auto
MEDSIM_LLM_EVALUATION_MODE=hybrid
```

The hosted URL is restricted to HTTPS on `openrouter.ai`. Deterministic predefined, protected, identity and fully resolved answers remain immediate. Semantic interpretation selects IDs from active-patient facts, uses temperature 0 and 200 output tokens, and is validated before the server composes authored replies. The legacy limited-candidate path retains its 80-token request. All hosted patient requests keep `reasoning.effort=none`. The selected configuration remains a 3-second inner hosted deadline and a 3.2-second outer semantic deadline including the shared inference gate. Controlled 3.2/5/8-second experiments paired inner deadlines of 3/4.8/7.8 seconds; configuration validation requires 0.2 seconds of headroom and caps the outer budget at 8 seconds. The separate 7-second general timeout belongs to optional evaluator enrichment, not patient dialogue. Local interpretation retains its separate configurable budget. See [hosted dialogue reliability](development/hosted-dialogue-reliability.md) for measurements, limitations, and commands.

Provider failures and invalid model selections emit the existing SSE error event, not clinical uncertainty. They do not commit dialogue context, transcript, scoring evidence, or audio. Chat restores the failed question with an accessible retry state; an unchanged manual retry retains its request ID so a lost terminal event can replay the server's cached success without a second clinical turn. Validated unavailable patient information still produces a normal clinical uncertainty answer. Hosted evaluator compatibility remains **unverified**; deterministic evaluation fallback is unchanged.

The allowlist retains the legacy Nex IDs for compatibility and adds the two individually verified free IDs; other models and dynamic routers remain rejected. Health verifies current zero prompt/completion prices and rejects mandatory reasoning. Requests additionally cap prompt, completion and per-request prices at zero, require parameter support and disable provider fallback. Legacy fallback environment fields cannot cause a second model request. JSON mode (`response_format`) alone is not reported as native strict-schema support; `structured_outputs` must be advertised.

## Commands

```powershell
# Hosted catalogue readiness; no completion request
powershell -ExecutionPolicy Bypass -File scripts/check-openrouter.ps1

# Hosted backend: load existing private configuration BEFORE singleton imports.
backend/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0, 'backend'); from medsim_backend.config import load_env_local; load_env_local(); import server, uvicorn; uvicorn.run(server.app, host='127.0.0.1', port=8787)"
npm run dev

# Optional offline preflight and explicit 1.7B opt-in
backend/.venv/Scripts/python.exe backend/local_ai_preflight.py
$env:MEDSIM_LLM_PROVIDER='llama_cpp'
$env:MEDSIM_LOCAL_LLM_ENABLED='true'
powershell -ExecutionPolicy Bypass -File scripts/start-local-ai.ps1 -Model 1.7b -Wait
```

Offline mode remains an explicit optional path. No local model starts automatically while OpenRouter is selected, and CI does not download or run any model.

## Academic limitations

Hosted or local model output is not clinically validated and is not claimed equivalent to Claude. Synthetic educational cases must not be replaced with real patient data. Schema validity and deterministic agreement do not establish medical correctness; clinician review remains required.

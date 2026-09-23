# Hosted-default and optional local AI architecture

## Provider decision

MedSim defaults to a backend-only OpenRouter provider and keeps local llama.cpp as an explicit offline option. OpenRouter receives only synthetic patient-safe facts or bounded learner evidence; it never receives browser credentials, unrelated case-bank data, internal paths, or real patient data. Kokoro remains local and patient text remains authoritative.

The OpenRouter catalogue was checked on 2026-09-15 through `/api/v1/models`. No Qwen-branded model ID ending in `:free` was available. A focused live comparison selected `nex-agi/nex-n2.5-mini:free` as primary and `nex-agi/nex-n2.5-pro:free` as the only fallback. These are configuration observations, not clinical or educational approval, and free availability can change.

Free availability varies. OpenRouter documents 50 free-model requests per day for accounts with less than 10 purchased credits and 1,000 per day after that threshold. Internet connectivity and provider capacity are required. Configure the API key's lowest available spending limit and model allowlist in the OpenRouter dashboard even though MedSim also enforces `:free`.

## Trust and scoring boundaries

Patient prompts are built by FastAPI from a server-only manifest. The browser submits an owner-bound attempt ID and question metadata. The server bounds input/history/output, treats learner text as untrusted, buffers and sanitizes output before SSE emission, and does not send diagnosis or rubric truth to the patient model. The opening greeting is deterministic and does not consume inference quota.

Evaluation accepts encounter evidence only. FastAPI restores the authoritative case/version, rubric, immutable weights, diagnosis, critical rules, guideline allowlist, and server-recorded orders. The model may classify semantic evidence and draft feedback. Positive verdicts must cite recorded evidence. Server code owns arithmetic, deterministic diagnosis/prescription facts, critical failures, and missing-evidence behavior. Invalid or unavailable model output uses deterministic fallback.

One patient request may be active per attempt. Completed patient requests are idempotent by correlation ID. One evaluation response is generated and cached per attempt. Each approved model is attempted at most once; only the non-inference model-catalogue check uses bounded exponential backoff.

## Configuration

```env
MEDSIM_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=nex-agi/nex-n2.5-mini:free
OPENROUTER_FALLBACK_MODELS=nex-agi/nex-n2.5-pro:free
OPENROUTER_PRO_FALLBACK_ENABLED=false
OPENROUTER_TIMEOUT_SECONDS=7
OPENROUTER_PATIENT_TIMEOUT_SECONDS=3
OPENROUTER_MAX_RETRIES=0
OPENROUTER_ALLOW_PAID_MODELS=false
MEDSIM_LOCAL_LLM_ENABLED=false

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

The hosted URL is restricted to HTTPS on `openrouter.ai`. High-confidence authored, predefined, protected, and clearly unavailable questions return before inference. Ambiguous typed questions use `reasoning.effort=none`, temperature 0.1, an 80-token ceiling, and one Mini request capped by `OPENROUTER_PATIENT_TIMEOUT_SECONDS` at 3 seconds. The separate general timeout is used by optional evaluator enrichment. Pro remains a valid explicit primary model but is disabled by default and never chained after Mini.

## Commands

```powershell
# Hosted catalogue readiness; no completion request
powershell -ExecutionPolicy Bypass -File scripts/check-openrouter.ps1

# Default hosted backend and frontend
backend/.venv/Scripts/python.exe backend/server.py
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

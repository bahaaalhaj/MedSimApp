# MedSim

MedSim is a desktop-first outpatient clinical-training simulator. Learners interview synthetic patients, order investigations, diagnose, prescribe, and receive a structured debrief.

> Formative training only. Synthetic cases, simplified doses, and model-generated language are not authoritative clinical guidance.

## Runtime architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Three.js |
| Patient dialogue | Backend-owned OpenRouter provider through SSE; optional offline llama.cpp |
| Patient speech | Optional local Kokoro; text remains authoritative |
| Backend | FastAPI on `127.0.0.1:8787` |
| Assessment | Server-owned deterministic rubric plus optional hosted evidence classification |
| State | One `Store` using `useSyncExternalStore` |

The browser cannot supply credentials, model endpoints, model names, system prompts, rubrics, diagnosis truth, or medicine expectations. OpenRouter is the default inference intermediary and Kokoro stays local. Evaluation still completes deterministically when hosted inference is unavailable or invalid.

## Windows setup

Prerequisites: Node.js 22+, Python 3.11/3.12, Internet access for OpenRouter, and `espeak-ng` on `PATH` for Kokoro.

```powershell
npm ci
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-tts.txt
Copy-Item backend/.env.example backend/.env.local
# Manually set OPENROUTER_API_KEY for live hosted inference; the configured free Mini model is pinned.
powershell -ExecutionPolicy Bypass -File scripts/check-openrouter.ps1
backend/.venv/Scripts/python.exe backend/prepare_kokoro.py
backend/.venv/Scripts/python.exe backend/server.py
# In another terminal:
npm run dev
```

On 2026-09-15 a focused live comparison kept `nex-agi/nex-n2.5-mini:free` as the only default hosted patient attempt. The live patient deadline is now capped at 3 seconds; the separate 7-second general timeout is reserved for optional evaluator enrichment. High-confidence authored and clearly unavailable questions bypass hosted inference entirely. Pro remains allowlisted but configuration-disabled and is never chained after Mini; failure goes directly to authored or safe-unknown fallback. Paid and random routing remain blocked.

The verified llama.cpp/Qwen 1.7B implementation remains an explicit offline option. It never starts while OpenRouter is selected; see [AI architecture and operations](docs/local-ai-architecture.md) for opt-in commands and the unchanged 2.5 GB RAM gate. See also [historical migration evidence](docs/archive/local-ai-migration-report.md) and [audio architecture](docs/audio-architecture.md).

## Verification

```powershell
npm test
node node_modules/typescript/bin/tsc -b
npm run verify
npm run clinical:validate
npm run clinical:verify-curation
npm run clinical:validate-investigations
npm run clinical:verify-generated
npm run security:scan
npm run lint
npm run format:check
npm run build
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
git diff --check
```

The same provider-disabled matrix runs in [CI](docs/ci.md) with pinned Node.js and Python runtimes. It does not require a paid API key, model download, or Kokoro inference.

See [API contracts](docs/api-contracts.md), [backend schema boundaries](docs/backend-schema.md), [application flow](docs/app-flow.md), and [local setup/deployment](docs/deployment-and-local-setup.md) for current implementation boundaries.

## Clinical governance

The learner-facing bank contains 72 versioned cases, three per specialty. `source-verified-formative` records source provenance, not physician approval. See [clinical case governance](docs/clinical-case-governance.md) and [review checklist](docs/clinical-review-checklist.md).

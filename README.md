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

For the working production-build student pilot, use the [Windows pilot guide](docs/windows-student-pilot.md).
For disk inventory, cleanup/restoration evidence and a source-only tree command,
see [Windows maintenance](docs/windows-project-maintenance.md).

Prerequisites: Node.js 22+, Python 3.11/3.12, Internet access for OpenRouter, and `espeak-ng` on `PATH` for Kokoro.

```powershell
npm ci
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-tts.txt
Copy-Item backend/.env.example backend/.env.local
# Manually set OPENROUTER_API_KEY for live hosted inference; the pinned free model is nvidia/nemotron-3.5-super-vl:free.
powershell -ExecutionPolicy Bypass -File scripts/check-openrouter.ps1
backend/.venv/Scripts/python.exe backend/prepare_kokoro.py
backend/.venv/Scripts/python.exe backend/server.py
# In another terminal:
npm run dev
```

The pinned hosted model is `nvidia/nemotron-3.5-super-vl:free`, without a fallback chain, paid routing or automatic completion retries. Ordinary launches default to a 3.0-second inner / 3.2-second semantic budget. The Windows pilot launcher deliberately applies **7.8 / 8.0 seconds** before provider initialization; queue waiting counts toward the semantic budget, while browser, validation and optional audio add overhead. Optional evaluator enrichment keeps its existing 3.5-second outer limit (the general provider timeout remains 7 seconds). Provider failure emits an honest SSE error; it does not fabricate patient speech. Authored deterministic answers remain available, and evaluation falls back to server-owned deterministic grading.

Examine contains History, Chat, Order tests, Results, Diagnose and Rx, with vital signs displayed. Examination is **Not assessed** for new encounters: raw points are out of **85** (data gathering **50**), with a separately labelled normalized percentage. Saved historical rubrics/evidence keep their original denominators. Active owner-bound encounters last six hours in memory and cannot survive backend restart; saved account reviews persist in SQLite. New browser attempts reconcile complete text using a request-ID receipt before grading; this acknowledges client acceptance, not proof that the student read or heard it. See [current pilot preparation and acceptance](docs/pilot-preparation-20261105.md).

The llama.cpp/Qwen 1.7B code path remains an explicit offline option. It was not started or revalidated in this task; its presence does not establish local-model readiness. It never starts while OpenRouter is selected; see [AI architecture and operations](docs/local-ai-architecture.md) for opt-in commands and the unchanged 2.5 GB RAM gate. See also [historical migration evidence](docs/archive/local-ai-migration-report.md) and [audio architecture](docs/audio-architecture.md).

## Verification

Install the offline test dependencies and enable TypeScript execution for Node 22.14.0. See [CI](docs/ci.md) for the complete provider-disabled environment.

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-test.txt
$env:NODE_OPTIONS = '--experimental-strip-types'
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
backend/.venv/Scripts/python.exe -m ruff check backend scripts/clinical/verify-review-workbook.py
npm run build
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
git diff --check
```

The same provider-disabled matrix runs in [CI](docs/ci.md) with pinned Node.js and Python runtimes. It does not require a paid API key, model download, or Kokoro inference.

See [API contracts](docs/api-contracts.md), [backend schema boundaries](docs/backend-schema.md), [application flow](docs/app-flow.md), and [local setup/deployment](docs/deployment-and-local-setup.md) for current implementation boundaries.

## Clinical governance

The learner-facing bank contains 72 versioned cases, three per specialty. `source-verified-formative` records source provenance, not physician approval. See [clinical case governance](docs/clinical-case-governance.md) and [review checklist](docs/clinical-review-checklist.md).

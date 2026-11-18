# AGENTS.md

## Project

MedSim is a desktop-first, outpatient-only clinical-training prototype with 24 specialties and 240 synthetic cases. There is no Emergency Room mode, dataset, route, or frontend workflow. Urgent outpatient escalation remains part of clinical case safety.

Detailed onboarding analysis is in `docs/codex-analysis/`.

## Runtime architecture

- React 18 + TypeScript + Vite SPA (`src/main.tsx`, `src/App.tsx`).
- One singleton `Store` with `useSyncExternalStore` (`src/game/store.ts`); do not add another state library without an explicit architectural request.
- Three.js outpatient scene (`src/components/three/Polyclinic.tsx`).
- FastAPI proxy/token service (`backend/server.py`).
- Text-first patient dialogue with local provider-based TTS (`src/voice/`, `backend/tts/`); Kokoro is default and Chatterbox is optional.
- Hybrid provider-neutral debrief uses server-owned deterministic scoring and frontend Zod schemas (`src/agents/`).
- SQLite-backed accounts and server sessions live in `backend/auth_system.py`; authenticated debrief history is server-owned, while onboarding/chat and namespaced guest history use browser `localStorage`.
- Separate Vercel guest demo: `api/index.py` / `backend/medsim_backend/demo_runtime.py`, no auth/SQLite/TTS imports; shared atomic Redis state and stable signed guests. See `docs/vercel-guest-demo.md`. Ordinary Windows entry points retain audio and SQLite.

## Critical paths

- Domain contracts: `src/game/types.ts`
- State/actions: `src/game/store.ts`
- Cases/catalogue: `src/data/polyclinicPatients.ts`, `src/data/cases.ts`
- Tests/treatments/medications/guidelines: `src/data/`
- Clinical action UI: `src/components/ExamineOverlay.tsx`
- Encounter/voice lifecycle: `src/components/EncounterScreen.tsx`, `src/voice/`
- Grading: `src/data/autoRubric.ts`, `src/agents/debriefRequest.ts`, `src/agents/useLocalDebrief.ts`, `src/components/DebriefScreen.tsx`
- Security/routing: `backend/server.py`, `backend/medsim_backend/demo_boundary.py`, `vite.config.ts`, `vercel.json`

## Known hazards

- Patient audio is non-authoritative; accepted transcript text in `ActivePatient` is the grading evidence. New browser attempts negotiate dialogueDeliveryVersion=1: unacknowledged recorded replies block fresh turns/evaluation until request-ID replay or owner recovery reconciles them. Client receipt is not proof of reading, screen paint or hearing.
- Polyclinic records prescriptions, not `givenTreatmentIds`; fallback clinical rubrics grade critical treatment IDs. `gradePrescription()` currently has no caller.
- Only three cases have authored guideline-cited rubrics; all guideline records are `auto-fetched`, not clinician-verified.
- Localhost Origin/Referer alone is not authentication. Development access additionally requires development mode and an actual loopback peer. Pilot ingress enforces an explicit host/origin and loopback peer without trusting forwarded headers.
- Frontend/backend evaluator result schemas are manually duplicated and must remain aligned.
- `POLYCLINIC_BED_INDEX = -10` is shared by store, scene, and conversation cache.
- `getCase()` silently returns the first case for an unknown ID.
- Historical notes may describe pre-outpatient prototypes; do not treat them as current behavior.
- Archived `node_modules` is non-portable; reinstall dependencies on the target platform.

## Current pilot contracts

- Pinned hosted model: `nvidia/nemotron-3.5-super-vl:free`; no paid fallback, model chain or automatic completion retries. Provider failure is an SSE error, not patient speech. Optional evaluator failure retains deterministic grading.
- Windows pilot entry prepares a 7.8-second inner / 8.0-second semantic deadline before provider settings import. Ordinary defaults remain 3.0/3.2; evaluator outer budget remains 3.5 seconds. Queue wait counts toward the semantic budget; audio/browser overhead does not.
- Examination controls are removed. New grading policy excludes its 15 points: raw maximum 85, data gathering 50, other weights unchanged; normalized percentage is separate. Saved reviews and older attempts retain their original rubric/evidence.
- Canonical investigation role is `potentially-harmful`, never `harmful`. Existing no-investigation-credit behavior and formative feedback apply to new evaluations; do not regrade cached/saved results.
- Active attempt recovery is owner-bound, in memory, six hours from creation, at most 32 per owner. Restart loses it. Saved account encounters persist in SQLite; optional Kokoro failure must preserve text.
- In `vercel-guest-demo` only, attempts/replay/receipts/evaluation use Redis with fixed six-hour expiry, fenced updates and recoverable operation leases. Failed/interrupted request IDs never redispatch; only a new manual submission may create a new request ID. Shared provider admission bounds cross-instance usage. Demo output is `dist-demo`; never replace the Windows pilot `dist` with it.
- See `docs/pilot-preparation-20261105.md` and `docs/windows-student-pilot.md`; historical reports are not current readiness evidence.

## Commands

```text
npm install
npm run dev
npm run verify
npm test
npm run build
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/server.py
backend/.venv/bin/python -m unittest discover -s backend/tests -v
backend/.venv/bin/python -m pip install -r backend/requirements-tts.txt
backend/.venv/bin/python backend/tts_benchmark.py
```

Use `Scripts/python.exe` on Windows. Keep the repository’s direct `node node_modules/<package>/...` script convention for environments that block `.bin` shims.

## Change protocol

1. Read the complete affected path and its callers/consumers.
2. Search for duplicate string IDs, schemas, prompt fields, and serialized shapes.
3. Make the smallest coherent change; preserve APIs, IDs, and history formats unless explicitly changing them.
4. Run type-check, Node tests, and verification. Run Python tests for backend changes and manually check the affected browser workflow.
5. For scene changes, inspect from multiple angles. For agent/audio changes, use a configured local TTS smoke test.
6. Report changes, side effects, checks, and remaining uncertainty.

## Clinical safety

Synthetic cases and simplified doses are not authoritative guidance. Distinguish technical implementation from medical validity. Do not change a clinical rule because it merely sounds right; cite the applicable approved source or flag it for physician review. Preserve human validation states, and never promote a guideline to `verified` automatically.

## Never assume

- README/spec matches implementation.
- A resolvable ID or citation is medically correct.
- Model output scores are arithmetically or clinically valid merely because Zod accepts them.
- Urgent or critical outpatient labels imply a separate application mode.
- A frontend-only success proves the configured patient model and local TTS runtime work.
- Real secrets may be copied into documentation, tests, logs, or client variables.

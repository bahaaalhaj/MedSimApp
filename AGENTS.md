# AGENTS.md

## Project

MedSim is a desktop-first clinical-training prototype. The **implemented UI is polyclinic only**: 24 specialties and 240 synthetic outpatient cases. ER data and APIs exist, but Emergency is locked and there is no ER frontend/state workflow. Do not describe dormant scaffolding as implemented.

Detailed onboarding analysis is in `docs/codex-analysis/`.

## Runtime architecture

- React 18 + TypeScript + Vite SPA (`src/main.tsx`, `src/App.tsx`).
- One singleton `Store` with `useSyncExternalStore` (`src/game/store.ts`); do not add another state library without an explicit architectural request.
- Three.js outpatient scene (`src/components/three/Polyclinic.tsx`).
- FastAPI proxy/token service (`backend/server.py`).
- Separate LiveKit voice worker (`backend/voice_agent.py`): Deepgram → Claude Haiku → Cartesia.
- Managed Agent debrief uses Opus and frontend Zod schemas (`src/agents/`).
- No database/accounts; browser `localStorage` holds onboarding, chat, and debrief history.

## Critical paths

- Domain contracts: `src/game/types.ts`
- State/actions: `src/game/store.ts`
- Cases/catalogue: `src/data/polyclinicPatients.ts`, `src/data/cases.ts`
- Tests/treatments/medications/guidelines: `src/data/`
- Clinical action UI: `src/components/ExamineOverlay.tsx`
- Encounter/voice lifecycle: `src/components/EncounterScreen.tsx`, `src/voice/`
- Grading: `src/data/autoRubric.ts`, `src/agents/debriefRequest.ts`, `src/agents/useAttendingDebrief.ts`, `src/components/DebriefScreen.tsx`
- Security/routing: `backend/server.py`, `middleware.ts`, `vite.config.ts`, `vercel.json`

## Known hazards

- Voice/text transcript and wrap-up checks are not sent to grading, although the prompt/UI imply they are.
- Polyclinic records prescriptions, not `givenTreatmentIds`; fallback clinical rubrics grade critical treatment IDs. `gradePrescription()` currently has no caller.
- Only three cases have authored guideline-cited rubrics; all guideline records are `auto-fetched`, not clinician-verified.
- Backend localhost Origin/Referer is an authentication bypass and must not be trusted in production.
- Frontend/backend custom-tool schemas are manually duplicated and must remain aligned.
- `POLYCLINIC_BED_INDEX = -10` is shared by store, scene, and conversation cache.
- `getCase()` silently returns the first case for an unknown ID.
- Documentation outside `docs/codex-analysis/` contains stale files, test counts, and ER claims.
- Archived `node_modules` is non-portable; reinstall dependencies on the target platform.

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
python -m venv backend/.venv-voice
backend/.venv-voice/bin/python -m pip install -r backend/voice_agent_requirements.txt
backend/.venv-voice/bin/python backend/voice_agent.py dev
```

Use `Scripts/python.exe` on Windows. Keep the repository’s direct `node node_modules/<package>/...` script convention for environments that block `.bin` shims.

## Change protocol

1. Read the complete affected path and its callers/consumers.
2. Search for duplicate string IDs, schemas, prompt fields, and serialized shapes.
3. Make the smallest coherent change; preserve APIs, IDs, and history formats unless explicitly changing them.
4. Run type-check, Node tests, and verification. Run Python tests for backend changes and manually check the affected browser workflow.
5. For scene changes, inspect from multiple angles. For agent/voice changes, use a configured sandbox smoke test.
6. Report changes, side effects, checks, and remaining uncertainty.

## Clinical safety

Synthetic cases and simplified doses are not authoritative guidance. Distinguish technical implementation from medical validity. Do not change a clinical rule because it merely sounds right; cite the applicable approved source or flag it for physician review. Preserve human validation states, and never promote a guideline to `verified` automatically.

## Never assume

- README/spec matches implementation.
- A resolvable ID or citation is medically correct.
- Model output scores are arithmetically or clinically valid merely because Zod accepts them.
- ER behavior exists because ER data/API definitions exist.
- A frontend-only success proves the deployed Agent/LiveKit configuration works.
- Real secrets may be copied into documentation, tests, logs, or client variables.

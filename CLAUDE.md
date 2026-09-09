# MedSim project notes

MedSim is an outpatient-only clinical simulation platform. After welcome,
onboarding, and authentication or guest entry, users select one of 24 medical
specialties, choose a synthetic outpatient case, complete a 3D consultation,
submit a diagnosis and prescription, and receive an AI-supported debrief.

## Architecture

- React 18, TypeScript, Vite, and Three.js via React Three Fiber.
- One `Store` using `useSyncExternalStore`; do not add another state library.
- Outpatient cases live in `src/data/polyclinicPatients.ts` and are catalogued
  by `src/data/cases.ts`.
- FastAPI provides authentication, account-owned progress, Managed Agent
  proxying, patient text streaming, and LiveKit room tokens.
- The separate LiveKit worker connects Deepgram STT, Claude Haiku, and Cartesia
  TTS. The attending debrief uses Claude Opus.

## Main paths

- `src/game/types.ts`, `src/game/store.ts`: state and actions.
- `src/components/three/Polyclinic.tsx`: active 3D outpatient scene.
- `src/components/EncounterScreen.tsx`, `src/components/ExamineOverlay.tsx`:
  encounter and clinical actions.
- `src/agents/`, `src/components/DebriefScreen.tsx`: evaluation.
- `backend/auth_system.py`, `backend/server.py`, `backend/voice_agent.py`:
  server-side runtime.

## Commands

```text
npm run dev
npm run verify
npm test
npm run build
backend/.venv/Scripts/python.exe backend/server.py
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
backend/.venv-voice/Scripts/python.exe backend/voice_agent.py dev
```

The application has no mode-selection screen. Authentication and guest entry
lead directly to specialty selection. Preserve severity, red-flag, safety-net,
and urgent-referral behavior within outpatient cases; these are clinical safety
concepts, not a separate gameplay mode.

Never place real secrets in client variables, documentation, logs, or tests.
Synthetic cases and simplified doses are not authoritative medical guidance.

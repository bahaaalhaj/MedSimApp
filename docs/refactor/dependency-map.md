# MedSim dependency map

This map records the current execution paths for Phase 2. Arrows show the
important direction of data/control flow; they are not permission to change
contracts.

## Frontend bootstrap and navigation

```text
index.html
  -> src/main.tsx
  -> src/App.tsx
  -> AuthProvider + singleton src/game/store.ts
  -> screen components selected by GameState.screen
```

`App.tsx` directly imports every screen it renders. `store.ts` owns the screen
union, identity gating coordination, current clinic, current patient, encounter
snapshot, transcript, examination state, investigation state, and end checks.
There is no route library. `middleware.ts` and Vercel rewrites apply only to
backend-shaped HTTP paths.

## Authentication and history

```text
AuthScreen/LoginForm/RegisterForm/GuestNotice
  -> src/auth/AuthProvider.tsx
  -> src/auth/authApi.ts
  -> /api/auth/session|register|login|logout
  -> backend/auth_system.py
  -> SQLite users/auth_sessions/clinical_encounters

HistoryScreen / src/data/evalHistory.ts
  -> authenticated: /api/progress/encounters[*]
  -> guest: localStorage medsim:guest:<id>:eval-history
```

`AuthProvider` also restores guest identity from browser storage and updates the
singleton store. The backend owns authenticated history; guest history does not
use account progress APIs. CSRF and session cookie behavior are implemented in
`auth_system.py` and tested by `backend/tests/test_auth.py` and
`scripts/test/auth.test.ts`.

## Clinical case catalogue and curation

```text
src/data/polyclinicPatients.ts
  -> src/data/cases.ts (safe learner DTO / catalogue adapter)
  -> src/game/store.ts + GPRoomScreen + CaseLibraryScreen + BriefScreen
  -> EncounterScreen / ExamineOverlay

src/clinical/cases.ts + curation.ts + migration.ts + types.ts
  -> assignability/version/review/legacy decisions
  -> scripts/clinical/* validation and export commands
  -> docs/generated/curation-manifest.json
  -> backend/server.py safe clinical catalogue
```

The current contract is 72 assignable cases and 168 archived cases. The
canonical clinical layer and the older-compatible `src/data` layer intentionally
coexist; `src/data/cases.ts` prevents ground-truth leakage in learner-facing
DTOs. `src/clinical/migration.ts` is an input to audit/export code even though it
is not a browser runtime import.

## Investigations

```text
src/clinical/investigations.ts
  -> src/clinical/investigationApi.ts
  -> src/game/store.ts / ExamineOverlay / EncounterScreen
  -> /api/attempts/{attempt}/investigations/orders
  -> backend/server.py
  -> docs/generated/investigation-manifest.server.json
  -> immutable attempt order/result snapshots
```

The server owns attempt binding, order validity, result release, and snapshot
immutability. `scripts/clinical/export-investigation-manifest.ts` generates the
server manifest. `src/clinical/investigationEvaluation.ts` and the backend
evaluation path consume the same investigation roles without exposing results
through safe catalogues.

## Patient dialogue and SSE

```text
EncounterScreen / FloatingPatientAudioPanel / DockedPatientAudioPanel
  -> voice/conversationStore.ts
  -> voice/conversation.ts + voice/localPatient.ts
  -> POST /agent/patient/stream
  -> Vite proxy or middleware.ts
  -> backend/server.py
  -> backend/local_ai.py deterministic authored/safe-unknown path
  -> backend/local_llm.py optional configured provider path
  -> SSE text chunks + done metadata
  -> transcript stored in game state as grading evidence
```

Patient audio is subordinate to transcript text. Request IDs, attempt IDs,
cached responses, bounded history, and cancellation are part of the behavior
contract. The backend stores the response before the browser requests speech.

## TTS and audio

```text
conversation.ts
  -> POST /tts/synthesize
  -> server.py -> backend/tts/providers.py
  -> Kokoro (default) or explicitly enabled Chatterbox
  -> audio_cache.py / kokoro_cache.py
  -> WAV response -> Web Audio buffer queue

BackgroundMusic.tsx -> /medsim.mp3
```

`backend/prepare_kokoro.py` is an explicit setup tool. Normal tests inspect
configuration and lifecycle without loading/downloading Kokoro. Voice policy,
cache keys, queue order, transcript text, and fallback semantics are behavior
boundaries.

## Evaluation and debrief

```text
EncounterScreen completion snapshot
  -> src/agents/debriefRequest.ts
  -> canonical rubric / autoRubric fallback / guideline slice
  -> src/agents/useLocalDebrief.ts
  -> /api/local-ai/evaluate
  -> backend/local_ai.py
  -> optional evidence classification through local_llm.py
  -> deterministic normalization and arithmetic
  -> DebriefScreen + evalHistory persistence
```

The frontend and backend maintain manually aligned evaluation schemas. The
server is authoritative for recorded evidence and deterministic arithmetic;
the model cannot add criteria, evidence, weights, diagnosis, or actions.

## Three.js scene

```text
GPRoomScreen / EncounterScreen
  -> @react-three/fiber Canvas
  -> Polyclinic.tsx
  -> Player.tsx + interactions.ts + createStore.ts
  -> StylizedCharacter.tsx + FloatingPatientAudioPanel.tsx
  -> singleton game store + patientPersona.ts
```

`Polyclinic.tsx` creates canvas textures internally and does not load external
image assets. The shared `POLYCLINIC_BED_INDEX = -10` links store, scene, and
conversation cache and must be preserved.

## Build, deployment, and verification edges

```text
package.json scripts
  -> scripts/test/run-all.ts
  -> scripts/verify/run-all.ts -> data-integrity, three-scene, rubric-smoke,
     clinical-cases
  -> scripts/clinical/* -> docs/generated/*

vite.config.ts -> local /api, /agent, /tts proxy
middleware.ts -> Vercel edge -> grand-rounds-backend.onrender.com
vercel.json -> production rewrites and SPA fallback
backend/Procfile -> uvicorn server:app
```

PowerShell scripts are externally invoked entry points. In particular,
`setup-local-ai.ps1`, `download-ranged.ps1`, `start-local-ai.ps1`, and
`start-medsim-local.ps1` create ignored runtime/model artifacts and should not
be judged by browser static imports.

## Duplicate or parallel sources of truth

| Concern | Parallel sources | Current risk |
| --- | --- | --- |
| Case content | `src/data/polyclinicPatients.ts`, `src/clinical/cases.ts`, `src/data/cases.ts` | Canonical/legacy adapter boundaries must remain explicit. |
| Curation | `src/clinical/curation.ts`, generated curation manifest, migration table | A generated manifest can become stale if exports are skipped. |
| Investigations | `src/clinical/investigations.ts`, generated server manifest, backend snapshots | IDs and case versions must stay aligned. |
| Rubrics | canonical assessment rubrics, `src/data/autoRubric.ts`, backend local-AI rubric projection | Fallback rubric is not equivalent to clinician-authored content. |
| Evaluation schema | `src/agents/evaluationSchema.ts`, backend `EVALUATION_SCHEMA` | Manual duplication can drift. |
| API contracts | `src/auth/authApi.ts`, frontend clinical API types, Pydantic models in `server.py`/`auth_system.py` | Paths, aliases, statuses, and SSE framing are cross-language contracts. |
| Audio policy | `patientPersona.ts`, backend TTS voice policy, generated/authored caches | Voice and cache-key changes affect audio behavior. |

## Coupling and size hotspots

Measured source sizes include `polyclinicPatients.ts` (~7,176 lines),
`Polyclinic.tsx` (~3,024), `server.py` (~826), `local_llm.py` (~605),
`local_ai.py` (~476), `store.ts` (~467), `EncounterScreen.tsx` (~424), and
`clinical/cases.ts` (~336). These are high-coupling files, not cleanup targets.
They connect data contracts, runtime state, clinical safety, or external
protocols and require characterization tests before any restructuring.

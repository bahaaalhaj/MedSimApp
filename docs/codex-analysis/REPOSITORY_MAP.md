# Repository Map (archived pre-local-AI audit)

> Historical snapshot only. See `docs/local-ai-architecture.md` for the current runtime.

## Roots and entry points

| Path | Role |
| --- | --- |
| `src/main.tsx` | Browser entry; storage cleanup and React mount |
| `src/App.tsx` | Screen switcher and two manual deep links |
| `src/game/` | State, domain types, specialty identifiers |
| `src/components/` | Screens and reusable UI |
| `src/components/three/` | Three.js room, player, avatar, interaction bus |
| `src/data/` | Cases, tests, medications, guidelines, imaging, assets metadata |
| `src/voice/` | LiveKit conversation, persona prompt, typed-chat stream, cache |
| `src/agents/` | Managed Agent transport, debrief request, schemas, hook |
| `backend/server.py` | FastAPI entry and all HTTP endpoints |
| `backend/tts/` | Lazy local patient-speech providers |
| `scripts/verify/` | Deterministic dataset and scene invariants |
| `scripts/test/` | Node test runner tests for custom tools and loop commands |
| `backend/tests/` | Python tests for authentication, progress ownership, and vault endpoints |
| `.claude/`, `agent/skills/`, `loop/` | Authoring/agent workflow instructions, not runtime application code |
| `dist/` | Checked-in generated frontend build; not source of truth |

## Important frontend screens

| Screen | File | Notes |
| --- | --- | --- |
| Splash/onboarding | `SplashScreen.tsx`, `OnboardingScreen.tsx` | First-run flow |
| Home/history | `HomeScreen.tsx`, `HistoryScreen.tsx` | Reads local evaluation history |
| Specialty selection | `GPRoomScreen.tsx` | Direct destination after authentication or guest entry |
| Cases/brief | `CaseLibraryScreen.tsx`, `BriefScreen.tsx` | Selects from derived 240-case catalogue |
| Encounter | `EncounterScreen.tsx` | Owns room, pointer lock, voice and overlay lifecycle |
| Clinical actions | `ExamineOverlay.tsx` | History, chat, tests/results, diagnosis, prescription |
| Wrap/debrief | `EndConfirmScreen.tsx`, `DebriefScreen.tsx` | Self-check then Managed-Agent grade |
| Explainers | `AgenticRoundsScreen.tsx`, `AgentTopologyScreen.tsx` | Static architecture/demo content; some claims are stale |

## Key data modules

| File | Actual content |
| --- | --- |
| `polyclinicPatients.ts` | 240 cases: 24 specialties × 10 |
| `tests.ts` | 80 tests and 49 convenience panels |
| `defaultTestResults.ts` | Fallback normal/abnormal text reports |
| `treatments.ts` | 19 ER-style treatment/disposition IDs |
| `medications.ts` | 107 outpatient medications, specialty filters, unused deterministic grader |
| `guidelines.ts` | 3 NICE guidelines, 22 recommendations; all `auto-fetched` |
| `autoRubric.ts` | Generic rubric for 243 cases without authored rubrics |
| `radiologyImages.ts` | Remote Wikimedia image mappings and fallbacks |
| `avatarModels.ts` | Remote GLB model pools and deterministic selection |
| `evalHistory.ts` | Browser persistence for up to 100 debriefs |

## Generated/dependency content

`node_modules/`, `dist/`, and `tsconfig.tsbuildinfo` were present in the archive. Treat them as generated. Do not review or edit them as authoritative source; recreate them from manifests and source when the platform supports it.

## Documentation reliability

`README.md` is useful for setup and the voice topology but overstates ER implementation. `CLAUDE.md`, `spec.md`, `docs/archive/evolution.md`, `docs/design-system.html`, and the two agent explainer screens contain stale paths, test counts, and feature claims. The source code and this directory should be used as the technical source of truth.

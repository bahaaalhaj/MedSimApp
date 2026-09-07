# Critical File Map

| Path | Purpose / main dependencies | Main consumers | Change risk |
| --- | --- | --- | --- |
| `src/game/types.ts` | All domain and state contracts | Store, data, UI, debrief | CRITICAL |
| `src/game/store.ts` | Navigation and all mutable encounter state; depends on cases and voice cache | Almost every screen | CRITICAL |
| `src/data/polyclinicPatients.ts` | 240 synthetic outpatient cases and 3 authored rubrics | Catalogue, store, voice, debrief, verification | CRITICAL |
| `src/data/cases.ts` | Flattens/deduplicates case catalogue and ID lookups | Library, brief, store, debrief | HIGH |
| `src/data/medications.ts` | Prescription choices, mappings, specialty filters, deterministic grader | Examine UI; data verifier | CRITICAL |
| `src/data/guidelines.ts` | Citation registry and validation state | Debrief request/UI, rubric verifier | CRITICAL |
| `src/data/tests.ts` | Test IDs/panels | Examine UI, debrief, data verifier | HIGH |
| `src/data/radiologyImages.ts` | Remote image selection by test/diagnosis | Results UI | HIGH |
| `src/data/autoRubric.ts` | Fallback grading contract for 243 cases | Debrief builder | CRITICAL |
| `src/agents/debriefRequest.ts` | Converts encounter state into agent grading evidence | Debrief hook/UI | CRITICAL |
| `src/agents/customTools.ts` | Frontend schemas and permission map | Debrief stream; tests; must match backend | CRITICAL |
| `src/agents/managedAgent.ts` | Agent HTTP/SSE transport, reconnect and dedupe | Debrief hook | HIGH |
| `src/agents/useAttendingDebrief.ts` | Session lifecycle and evaluation extraction | Debrief screen | CRITICAL |
| `src/components/DebriefScreen.tsx` | Displays and persists grading | Home/history and users | HIGH |
| `src/components/ExamineOverlay.tsx` | All structured clinical actions | Store and debrief evidence | CRITICAL |
| `src/components/EncounterScreen.tsx` | Coordinates 3D, pointer lock, voice, dispatch | Core consultation workflow | CRITICAL |
| `src/components/three/Polyclinic.tsx` | 3D world, patient animation, voice-panel mount | Encounter screen | HIGH |
| `src/voice/conversation.ts` | LiveKit lifecycle, transcript, typed fallback, farewell | Voice panels/cache | CRITICAL |
| `src/voice/patientPersona.ts` | Adult/pediatric prompts from case data | Conversation cache | CRITICAL |
| `backend/server.py` | All HTTP auth, schemas, prompts, APIs, token mint | Entire frontend and external providers | CRITICAL |
| `backend/voice_agent.py` | STT/LLM/TTS pipeline and farewell RPC | LiveKit rooms | CRITICAL |
| `vite.config.ts`, `vercel.json`, `middleware.ts` | Dev and production request routing/security | Every backend call | CRITICAL |
| `scripts/verify/*` | Static integrity gates | Data and rubric changes | HIGH |

## Before modifying a critical file

Read the complete caller/consumer path, search for the same string IDs or schema on both sides, and run type-check, Node tests, verification scripts, and relevant Python tests. Clinical data changes also require physician review; prompt/schema changes require a live sandbox smoke test before deployment.

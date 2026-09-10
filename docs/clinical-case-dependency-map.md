# Clinical case dependency map

This map records the runtime dependencies inspected before the governance migration.

| Producer | Consumers | Contract / risk |
|---|---|---|
| `src/data/polyclinicPatients.ts` | `src/data/cases.ts`, store, voice persona, investigation UI, debrief packager, verification scripts, agent-development screens | Legacy `PatientCase` combines public presentation and private truth. It remains compatibility data and is not an approval source. |
| `src/data/cases.ts` | GP room, case library, brief, debrief, history/store | Catalogue DTO previously derived and displayed the correct diagnosis as `cond`; it now emits a neutral pre-submission label and governance metadata. |
| `src/game/store.ts` | All navigation, encounter UI, Three.js scene, voice cache | Singleton state owns assignment and active-patient snapshots. Assignment now filters by lifecycle mode and stores case/rubric versions and variant seed. |
| `src/data/defaultTestResults.ts` | `ExamineOverlay`, `debriefRequest` | Previously fabricated a normal report when no case result existed. It now returns the same explicit unavailable text to learner and evaluator. |
| `src/data/autoRubric.ts` | `debriefRequest`, rubric verification | Still supports legacy development cases. Curated approval validation requires an explicit canonical rubric. |
| `src/data/guidelines.ts` | debrief request/renderer, agent-development screens, verification | Legacy recommendation registry remains an agent allowlist. Normalized source metadata lives in `src/clinical/references.ts`; neither registry grants approval. |
| `src/data/medications.ts` | prescription tab and legacy generic grader | Generic `gradePrescription()` remains legacy-only. Canonical cases use `src/clinical/prescriptionValidation.ts`; unresolved dose review is reported explicitly. |
| `src/voice/patientPersona.ts` and conversation cache | Three.js/docked voice panels, debrief transcript | Persona receives legacy case history; transcript is included in debrief when available, but trustworthy per-message timestamps are not yet captured. |
| `src/agents/debriefRequest.ts` | `DebriefScreen`, managed attending | Packages private truth after encounter plus exact learner-visible answers/results, transcript, status checks, versions, seed, and medication validation. |
| `src/agents/useAttendingDebrief.ts` | `DebriefScreen` | Model outputs are schema-checked; deterministic normalization now recomputes scores from immutable rubric weights. |
| `backend/server.py` | auth/progress, managed agent, voice, safe case API | Safe catalogue endpoints omit truth. Full server-owned attempt delivery is not yet wired into the legacy SPA and remains a confidentiality limitation. |
| `src/data/evalHistory.ts` / auth progress API | home/history/debrief | Stores exact patient snapshot plus case version, rubric version, and variant seed; old entries remain readable with optional provenance fields. |

Stable compatibility constraints: public case IDs are unchanged, `POLYCLINIC_BED_INDEX = -10` is unchanged, the singleton store remains, all 24 specialty IDs and `all-specialties` remain, and no Emergency Room workflow was introduced.

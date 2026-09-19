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
| `src/voice/patientPersona.ts`, conversation layer, and `ActivePatient.transcript` | Three.js patient-audio panels and debrief | The frontend constructs only the deterministic public greeting; the backend builds the closed-world patient prompt. Timestamped text is captured before optional speech and included in debrief evidence. |
| `src/agents/debriefRequest.ts` | `DebriefScreen`, `useLocalDebrief` | Builds the complete local UI record. The network hook sends only learner evidence and provenance; private truth, rubric weights, and medication expectations are restored on the server. |
| `src/agents/useLocalDebrief.ts` | `DebriefScreen` | Calls the owner-bound local evaluator endpoint. Responses are schema-checked in both tiers, while the backend deterministically recomputes verdict overrides, scores, and critical failures. |
| `backend/server.py` | auth/progress, owner-bound attempts, local patient/evaluation, voice, safe case API | Patient prompts and evaluator truth are server-owned; the legacy SPA still contains some display/scoring case data. |
| `src/data/evalHistory.ts` / auth progress API | home/history/debrief | Stores exact patient snapshot plus case version, rubric version, and variant seed; old entries remain readable with optional provenance fields. |

Stable compatibility constraints: public case IDs are unchanged, `POLYCLINIC_BED_INDEX = -10` is unchanged, the singleton store remains, all 24 specialty IDs and `all-specialties` remain, and no Emergency Room workflow was introduced.
# Curation boundary

`src/clinical/curation.ts` is the selection contract. `src/clinical/cases.ts`, `src/data/cases.ts`, the store, server-safe manifest, exports and tests consume that boundary. Archived IDs may remain in `polyclinicPatients.ts` only as historical source records and must never feed learner assignment.

# Final post-refactor acceptance audit

Date: 2026-09-23  
Baseline reference: repository inventory baseline commit `490262b29ff517300f777bd827958f4a8a86b87d`  
Audit status: **not fully accepted** because no browser surface, live OpenRouter credential, or prepared Kokoro runtime was available.

This is a technical regression audit, not medical validation, accreditation, or evidence of educational effectiveness.

## Evidence classes

- **Automated**: an executable test, validator, build, or scan passed in this working tree.
- **Manual**: a person or browser-automation session exercised the visible workflow.
- **Inferred**: source/dependency inspection supports the behavior, but the complete runtime journey was not executed.
- **Not tested**: the required runtime or surface was unavailable.

## Representative coverage

| Requirement | Representative | Evidence | Result |
| --- | --- | --- | --- |
| Adult male | `im-003` | Profile name/gender/vital matching, exact six-question case data, diagnosis/evaluation fixtures, and male Kokoro family tests | Automated components pass; full UI journey not tested |
| Adult female | `im-004` | Canonical case validation, six-question data, prescription/evaluation contracts, and female Kokoro family coverage | Automated components pass; full UI journey not tested |
| Pediatric/parent | `peds-001` | Frozen complete-evaluation fixture, parent dialogue prompt test, pediatric TTS policy, and six-question data | Automated components pass; full UI journey not tested |
| Lab-dependent diagnosis | `im-001` | Canonical investigation records and ordered-result API tests | Automated data/API checks pass; full UI journey not tested |
| Imaging-dependent diagnosis | `im-005` (`cxr`) | Structured investigation validation and result presentation contracts | Automated data/presentation checks pass; full UI journey not tested |
| Medication/prescription | `im-004` | Controlled prescription UI contract, server recording, evaluation evidence, and snapshot tests | Automated contracts pass; full UI journey not tested |
| Critical safety criterion | `allergy-001` | Frozen `allergy-empty` clear-fail fixture with safety breach; server-authoritative action tests | Automated scoring fixture passes |
| OpenRouter unavailable | `allergy-001` | Provider-failure test proves authored or safe-unknown text and deterministic evaluation fallback | Automated pass; no live provider outage test |
| Kokoro unavailable | shared encounter path | Disabled/missing-cache tests plus browser text-before-TTS and replay/race contracts | Automated pass; no actual audio-device test |
| Backend restart/session restoration | authenticated user | Added service-reconstruction regression test against the same SQLite database | Automated pass; process/host restart not performed |

The rows above are representative data and service-path coverage. They are not ten independent end-to-end browser executions.

## Learner-journey checks

| Behavior | Evidence | Classification |
| --- | --- | --- |
| Login and guest access | Frontend auth/guest contracts and backend cookie/CSRF/session tests | Automated |
| Specialty and patient selection | Outpatient catalogue/navigation contracts; exact 72-case projection | Automated |
| Opening greeting | Deterministic greeting and conversation creation contracts | Automated |
| Name, age, and gender questions | Server deterministic profile-intent tests | Automated |
| Six predefined questions | Canonical cases expose six anamnesis items; predefined routing tests pass | Automated data/service; UI use inferred |
| Typed questions | Text-first typed routing and provider-fallback tests | Automated |
| Examine button and `E`/`e` shortcut | Component contract covers click and guarded keyboard access | Automated static contract |
| Examination evidence | Attempt-bound action/idempotency and snapshot tests | Automated |
| Investigation ordering and result release | Owner-bound ordering, immutable snapshots, unavailable/conditional behavior, and Results UI contracts | Automated |
| Diagnosis submission | Server-authoritative diagnosis and extracted-tab contracts | Automated |
| Prescription | Controlled fields, submission/locking/evidence contracts | Automated |
| Finish Consultation | Validation, duplicate-click gate, immediate finalization, audio disposal, and navigation contracts | Automated |
| Immediate debrief navigation | Store/encounter completion tests | Automated |
| Deterministic objective credit | Frozen evaluation fixtures and deterministic normalization tests | Automated |
| Safety-critical failure logic | Frozen clear-fail/safety-breach fixture | Automated |
| Saved account history | Authenticated ownership/persistence tests and frontend history API contracts | Automated |
| Transcript and version provenance | Transcript packaging, attempt/case/version guards, and generated manifest checks | Automated |
| Male/female/parent voice family | All curated adult mappings and pediatric parent-policy tests | Automated; audible voice not tested |
| Text-only continuity when TTS fails | TTS-disabled tests and conversation race contracts | Automated |
| No diagnosis leakage | Safe DTO tests, prompt-injection tests, and production-bundle leakage scan | Automated |

## Phase 0 comparison

| Measure | Phase 0 evidence | Current result | Comparison |
| --- | --- | --- | --- |
| Assignable/archive counts | 72 / 168 | 72 / 168 | Unchanged |
| Investigation records | 422 | 422 | Unchanged |
| Canonical checksum | `sha256:782798a2db90fac7da32189e5e2706207aec4eaaff6127d1ab90c32afe59db14` | Same generated metadata | Unchanged |
| Review semantic checksum | `sha256:3fdeaa0be3d244e1d6809f082af378d2735f15a93d45ae7536d2d254ccb25a70` | Same generated metadata | Unchanged |
| Evaluation fixtures | Frozen acceptance file | All fixtures pass | Unchanged outputs |
| API contracts | Existing public route surface | Route methods, statuses, request fields, and health fields pass | No detected change |
| Build | No reproducible Phase 0 size/timing artifact recorded | 712 modules; JS 1,552,649 bytes (425.76 kB gzip); CSS 15,509 bytes (3.94 kB gzip) | Current only; size delta cannot be claimed |
| Test count | Baseline tree contains 9 Node test files and 6 backend test files; assertion count was not recorded | 83 Node tests and 79 backend tests pass | Coverage increased; exact assertion delta unavailable |
| Backend startup/auth latency | No Phase 0 timing sample | Focused login/session test: 0.598 s test time, 3.770 s including interpreter/import startup | Current sample only |
| Patient text latency | Historical hosted benchmark records a 3 s cap and a 15.02 s disabled-Pro median; no Phase 0 comparable sample | Provider-unavailable authored/safe fallback test: 0.082 s test time, 2.786 s including interpreter/import startup | Not a live OpenRouter comparison |
| Cached/uncached audio | No comparable Phase 0 measurement | In-memory/persistent cache and disabled-provider tests pass; focused cache test 0.025 s test time | Contract only; no Kokoro inference timing |
| Memory/cleanup | No Phase 0 process-memory trace | Audio nodes, timers, subscribers, abort controllers, queue disposal, and duplicate-finish behavior pass tests | Structural/race coverage; no heap profile |

## Automated verification

- TypeScript project build: passed.
- Frontend/Node suite: 83 passed, 0 failed.
- Repository verification: 4 passed, 0 failed.
- Clinical validation: 72 canonical cases passed.
- Curation: 72 assignable, 168 archived, three per specialty.
- Investigation validation: 72 cases and 422 records passed.
- Generated artifacts: current and semantically reproducible.
- Production answer-leakage scan: 0 of 134 server-only truth strings in 1,552,649 JavaScript bytes.
- Backend suite: 79 passed, 0 failed.
- Production build: passed in 13.81 s (712 modules); ESLint, Prettier contract, Ruff, CI safety scan, and `git diff --check`: passed.

## Manual verification

No manual browser verification was possible. The computer-use inventory returned no apps or browsers. Consequently visual fidelity, keyboard focus in a real browser, autoplay handling, audible voice quality, real device playback, and complete click-through journeys remain unverified.

## Findings

No refactor-introduced application regression was demonstrated by the automated matrix. One missing regression check was added for authentication-session restoration after reconstructing the auth service over the same SQLite file.

The audit found a pre-existing pediatric consistency risk: the frontend visual-parent gender helper hashes `${caseId}-parent` while the backend voice policy hashes `${caseId}:parent`. This difference exists at the Phase 0 baseline commit and was not changed because Phase 11 permits only refactor regressions to be fixed. The pediatric speech path still selects an adult parent/narrator voice; alignment with the visible parent is not established.

## Acceptance decision

Do **not** declare final acceptance complete. Automated regression gates are green, but the required representative journeys have not been manually executed and live OpenRouter/Kokoro behavior was not tested. The next step is a controlled browser acceptance session with provider-disabled text-only runs first, followed by configured OpenRouter and prepared Kokoro smoke runs on the target machine.

# Consultation-management observations

> Subsequent metadata update: the owner reported approval of all 446 supplemental history additions by الدكتور محمد الأحمد; see [the review record](history-additions-approval.md). These additions remain non-scoreable and excluded from the observation indicators. References to 446 pending reviews below describe the earlier implementation baseline, not the current approval state.

Implemented 2026-10-16. These are conservative, formative observations of recorded actions, **not a validated medical assessment, new clinical score, or accreditation**. Existing criterion verdicts, rubric weights, critical-failure rules, clinical facts, and numerical scores are unchanged. No percentage weight for speed has been introduced.

## Purpose and authority

The requested approach evaluates focused questions, possible repetition, ordering of recorded actions, and completing the plan/safety checks without rewarding haste. The existing count-up timer remains contextual evidence only; elapsed minutes cannot affect any indicator or clinical mark. Two otherwise identical consultations of different durations receive identical observations.

The [RCGP SCA marking guidance](https://www.rcgp.org.uk/mrcgp-exams/simulated-consultation-assessment/marking-and-results) informs the general idea of consultation management and prioritisation. It does **not** validate MedSim's implementation or provide a medically approved percentage for time. The local rules below are deliberately explicit and require further educator review before high-stakes use.

The backend creates an optional `consultation_management` field on the existing evaluation response, after normal clinical scoring. The browser only validates and presents it. No new endpoint, request field, hosted request, environment setting, database migration, clinical generation, or provider timeout is introduced. The existing deterministic evaluation fallback is preserved.

## Indicators and evidence limits

| Indicator | Recorded evidence | Conservative interpretation |
| --- | --- | --- |
| Focused questioning | Existing authored `relevant` labels on eligible, provenance-matched history sources | At least one relevant source is documented coverage, not proof the entire history was sufficient. Unknown questions are not automatically irrelevant. |
| Repetition review | Same normalised question **and** same eligible history-source set in separate successful recorded turns | Flags a possible repeat for review, not a penalty. Confirmation may be appropriate. New wording or new sources is not classified as repetition. |
| Priority sequencing | Existing authored essential/harmful investigation roles, server order/release timestamps, first server-recorded diagnosis submission | Observes whether existing essential results were released before diagnosis; release does not prove the learner read them. Missing chronology is not assessable. No new clinical ordering rule or urgency threshold is invented. |
| Plan and safety | Existing diagnosis/investigation rubric verdicts, diagnosis authority, original safety assessment, and three completion checks | Completion checks remain learner-reported. Neither spoken delivery nor prescription appropriateness is independently established by this report. Existing critical safety failures remain visible and unchanged. |

Each indicator is `documented`, `review-recommended`, or `not-assessable`, with counts and a bounded explanation. Overall status is a review flag or evidence-availability summary, not a competence grade. Existing investigation roles and relevance labels retain their current source/curation limitations; the report does not promote them to clinician-verified or override their scoreability.

History analysis uses only the retained server transcript window (at most 256 rows) for evidence-version-2 attempts, with matching case/version and deterministic/predefined authored provenance. Model-interpreted selections and pending-review/non-scoreable draft sources are excluded. A compound turn containing an excluded history source is also excluded, so newly supplied information is not discarded and then misclassified as a duplicate. This preserves all 446 pending clinical reviews.

Unanswered requests, retry-cache replay, and audio replay do not create additional assessed history turns. Missing or older evidence remains explicitly limited rather than fabricated. The report never copies raw questions, answers, names, diagnosis truth, or reference contents into its explanations.

The first successful diagnosis submission records an internal server timestamp once. Same-diagnosis idempotent retries do not reset it; old submitted attempts without that event are not retrospectively timed. It is a server-receipt timestamp, not proof of when the learner formed a diagnosis. A deep-copied observation snapshot is captured before any optional provider wait, preventing later attempt mutations from changing this report mid-evaluation.

Existing cached evaluations and saved reviews are not regenerated. The new field is optional for historical compatibility and is retained by the existing JSON persistence path. The timer remains explicitly client-observed and unscored.

## File scope

Created:

- `backend/medsim_backend/consultation_management.py`: pure deterministic observation assembly; no providers, mutations, or score arithmetic.
- `backend/tests/test_consultation_management.py`: unit and actual endpoint regressions, including all 72 cases.
- `src/components/debrief/ConsultationManagement.tsx`: presentation-only debrief section.
- `scripts/test/consultation-management.test.ts`: schema, persistence compatibility, SSR presentation/escaping, and integration-boundary tests.
- This document.

Modified, preserving pre-existing worktree changes:

- `backend/medsim_backend/services/attempt_service.py`: first successful diagnosis event timestamp only.
- `backend/medsim_backend/services/evaluation_service.py`: capture observation snapshot and attach formative report after unchanged scoring.
- `src/agents/evaluationSchema.ts`: optional, bounded report contract and inferred TypeScript type.
- `src/components/debrief/EvaluationDetails.tsx`: one presentation component invocation.

No files deleted, moved, or archived. No store, audio, transcript-writing, API input, provider, scene, case, or generated clinical files changed in this task. No commit or push.

## Verification

The new tests were added before implementation (missing module/export failed as expected). Baseline frontend tests: 112 passed; frozen evaluation acceptance fixture: 1 passed before edits. Focused new backend suite: 16 passed; focused new frontend suite: 4 passed.

Full verification completed successfully (all exit codes 0):

| Command | Actual result |
| --- | --- |
| `backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v` | 218 passed in 137.064 s, including frozen evaluation acceptance and authentication/migration regressions |
| `npm test` | 116 passed, 0 failed/skipped, in 20.913 s |
| `node node_modules/typescript/bin/tsc -b` | Passed |
| `npm run verify` | 4 checks passed |
| `npm run build` | Passed; 715 modules transformed |
| `npm run clinical:validate` | 72 canonical cases passed |
| `npm run clinical:references` | 72 case-reference rows, 66 references; output bytes preserved |
| `npm run clinical:audit` | 72 source-verified-formative, 168 archived, 0 approved-formative |
| `npm run clinical:verify-curation` | 72 assignable, 168 archived, 3 per specialty |
| `npm run clinical:validate-investigations` | 422 records across 72 cases passed |
| `npm run clinical:verify-generated` | Outputs current and semantically reproducible |
| `npm run security:scan` | Passed; no secret-shaped values or runtime artifacts in 288 tracked paths |
| `npm run security:scan-frontend` | Production frontend exposes 0 of 292 server-only truth strings |
| `git diff --check` | Passed |

An additional offline, in-process real-route smoke passed for **72/72 cases**, exit 0: predefined question, same-request replay, a separately submitted repeated question, essential-result release, diagnosis, completion checks, and evaluation. Each report counted exactly two successful history turns, one possible repeat (not the cached replay), one relevant source, documented result-before-diagnosis ordering, and three completion checks. Hosted completion calls: 0; TTS model loads: 0. This is endpoint integration testing, not live-browser or hosted inference validation.

Clinical semantics and the 446 pending draft reviews remain unchanged. All 324 tracked/untracked, non-ignored files outside this task's nine-file scope match the pre-edit SHA-256 snapshot, including prior user changes. Aggregate checksum: `c92614c02c87b39f70846f0cf2e0858f1bae284a42fa66b3b797934771bd7a8c`. HEAD remains `584cfc732804fdb3653ad4d42e2774d85b5761b8`; nothing staged, committed, or pushed.

Existing warnings remain: Vite's >500 kB chunk advisory, AnyIO `BlockingPortal` deprecation, and Git LF-to-CRLF notices. Warning/error events in negative-path tests are expected simulated failures, not actual hosted requests. These passing tests do not establish medical validity.

## Manual check still required

No interactive browser or live hosted/TTS validation was performed for this change. Server tests use unavailable/mock providers; SSR tests exercise actual presentation but not a mounted browser. No new inference quota is consumed and no model is downloaded or loaded.

Restart only MedSim's backend from the environment-first entry point (`backend/.venv/Scripts/python.exe backend/server.py` from the repository root), refresh, and start a **new** consultation (restart clears in-memory attempts). This entry point loads the existing private configuration before providers; do not use the separate local-model startup script for this change. Finish the consultation and inspect the four indicators and evidence limitations in the debrief. Check a safe slow consultation versus the same actions performed faster: duration should differ, not the indicator results or clinical marks. Also review a saved historical debrief without the new field; it must not show fabricated observations. The running backend has not been restarted by this task.

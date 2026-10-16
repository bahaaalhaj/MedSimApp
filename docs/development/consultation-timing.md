# Consultation count-up timer (2026-10-16)

## Delivered scope

The fixed `8:00` briefing, eight decorative time bars, and unused runtime
`deadlineMs = now + 8 minutes` were removed. All 72 assignable cases use the same
unbounded count-up behavior; there are no case-specific time targets, deadline
warnings, time-based auto-submission, or time-based failures.

The existing **Knock and enter** gesture now initializes the encounter before
navigating to its screen. The counter starts with that action, not while reading
the briefing. Accepting the next patient or entering the encounter through the
existing direct-navigation fallback also starts a fresh counter. Returning to an
already active encounter does not reset it.

A small non-interactive `Elapsed · MM:SS` timer stays visible at the top left,
including while Examine is open. Minutes can exceed 59. The React component
updates only its own presentation once a second and disposes its interval on
finish/unmount. It does not mutate the encounter store on each tick or touch the
3D scene/audio path. Its timer role has `aria-live="off"` to avoid repeated
screen-reader announcements.

Existing Finish Consultation/End consultation paths freeze the timestamp in the
completed patient snapshot. Closing Examine or submitting a diagnosis alone does
not stop the consultation timer. Time in debrief, model evaluation, retrying the
evaluation, and historical review is not added. Saved legacy encounters with no
frozen timing display **Duration not recorded**, not a fabricated zero or an
ever-growing duration. The existing unused `deadlineMs` field in a historical
test fixture is retained; it has no runtime consumer.

## Evaluation contract and explicit limitation

`POST /api/local-ai/evaluate` retains its path, status, ownership/provenance,
deterministic grading and fallback. It accepts one new optional field:

```json
{"encounterTiming":{"startedAtMs":1000,"finishedAtMs":126000}}
```

New timing-aware requests receive an additive result:

```json
{"consultation_timing":{"elapsed_ms":125000,"elapsed_minutes":2.0833333333333335,"source":"client-observed","scored":false}}
```

Old requests remain valid and receive no fabricated timing field. The backend
derives minutes, validates finite nonnegative chronological timestamps, rejects
unknown nested fields, and binds evaluation to the existing owner/case/version/
variant checks. Cached evaluation responses retain the original timing even if
a later retry supplies different observations. Zod validates the additive field;
existing account/guest JSON persistence retains it without a database migration.

**Duration is recorded in the evaluation, but does not yet change its numeric
clinical marks.** No approved weighting/formula was supplied; the proposed 90/10
split was not approved and is not implemented. The UI explicitly says
`duration recorded, not scored`. The timestamps originate in the browser and
are not server-verified or cheat-resistant. They are never sent to the hosted
evaluator or used as authoritative scoring evidence. Do not rank learners or
claim a higher overall score on the basis of this client clock.

A future time-derived score needs an agreed non-target-based formula and a
server-verified start/finish clock, plus a policy for runtime/provider delays.
That is deliberately not invented here. This delivery must not be described as
completed time-weighted grading or completed examination redesign.

Wall-clock duration includes time spent in other tabs, waiting for tests/audio,
and provider/service waits while the consultation is active. A changed device
clock can affect this descriptive value. There is no pause control. Existing
six-hour server-attempt expiry remains a technical ownership/storage policy,
not a newly introduced clinical deadline.

## Files and preservation

Created:

- `src/game/consultationTiming.ts`: duration/format/freeze helpers.
- `src/components/encounter/ConsultationTimer.tsx`: count-up presentation.
- `scripts/test/consultation-timing.test.ts`: helper, snapshot, JSX/hook regressions.
- `backend/tests/test_consultation_timing.py`: optional-contract/security regressions.
- `docs/development/consultation-timing.md`: this report.

Modified:

- `src/game/types.ts`: optional historical-compatible start/finish fields; remove
  unused deadline field.
- `src/game/store.ts`: begin on entry, fresh timing on new patients; existing
  shared state and all unrelated actions remain intact.
- `src/game/encounterState.ts`: freeze once at existing snapshot boundary.
- `src/components/BriefScreen.tsx`: replace fixed deadline with no-limit copy and
  connect the entry gesture.
- `src/components/EncounterScreen.tsx`: mount the small timer only.
- `src/components/debrief/EvaluationDetails.tsx`: render frozen duration, not
  time elapsed since arrival at the moment of reading.
- `src/agents/debriefRequest.ts`: carry completed timing observations.
- `src/agents/useLocalDebrief.ts`: pass the optional timing field.
- `src/agents/evaluationSchema.ts`: validate optional descriptive metadata.
- `backend/medsim_backend/schemas.py`: validate optional observation input.
- `backend/medsim_backend/services/evaluation_service.py`: attach metadata outside
  the scoring/model paths, then use existing evaluation persistence/replay.
- `backend/tests/test_route_contract.py`: permit only this additive input field;
  existing routes, methods, declared statuses and other fields remain checked.

No files deleted, archived or moved. No new dependency, environment setting,
database migration, clinical source/generated-artifact edit, model/TTS change,
backend restart, commit or push. Examination/self-certification is not changed
in this timer-only continuation. No clinical validity/accreditation is claimed.

## Checks and manual follow-up

Tests were added before implementation. The new Node run initially failed
because its helper did not exist; after correcting a synthetic case ID in the
new Python fixture, the Python run demonstrated the missing optional contract.
Baseline frontend tests: 104 passed; frozen deterministic evaluation fixture
test passed before changes.

New regressions cover unbounded duration beyond 8 minutes, minute/second
formatting, finish-once/replay behavior, immutable completion snapshots,
historical/invalid timestamps, frozen evaluation input, actual timer JSX with
controlled hooks/ticks and cleanup, optional legacy API compatibility, malformed
and nonfinite input, ownership/provenance, and unchanged clinical scoring.
A separate temporary SQLite round-trip confirmed the frozen snapshot and timing
metadata survive existing persistence without schema changes or real accounts.

Manual browser layout and complete click-to-finish workflow remain unverified.
The actual timer component was rendered with React's server renderer and
controlled hooks, not a real browser. No new live hosted inference or voice
model load/download was needed.

Before browser testing, restart the backend in your own terminal so it accepts
the additive field, refresh the frontend, and start a new consultation. Restart
clears existing in-memory attempts. Check that the briefing has no eight-minute
target, the counter persists across tab/modal changes, Finish freezes it, and
historical review preserves the same value. Check narrow screens for overlap.

Actual verification results after the final source changes:

| Command/check | Result | Exit |
| --- | --- | --- |
| `node --test scripts/test/consultation-timing.test.ts` | 8 passed | 0 |
| Backend focused `test_consultation_timing.py` discovery | 7 passed | 0 |
| `python -m unittest discover -s backend/tests -v` (backend venv) | 202 passed in 110.660 seconds, including frozen evaluation fixtures | 0 |
| `npm test` | 112 passed | 0 |
| `node node_modules/typescript/bin/tsc -b` | Passed | 0 |
| `npm run verify` | All 4 checks passed | 0 |
| `npm run build` | Passed; JS 1,551.44 kB / gzip 426.12 kB | 0 |
| `clinical:validate`, `clinical:references`, `clinical:audit` | 72 canonical cases, 72 reference rows / 66 references | 0 each |
| `clinical:verify-curation` | 72 assignable / 168 archived | 0 |
| `clinical:validate-investigations` | 422 records across 72 cases | 0 |
| `clinical:verify-generated` | Committed outputs current and semantically reproducible | 0 |
| `security:scan` | 288 tracked paths passed | 0 |
| `security:scan-frontend` | 0 of 292 protected truth strings exposed in 1,552,019 JS bytes | 0 |
| Temporary SQLite timing persistence check | Passed without schema changes | 0 |
| `git diff --check` | Passed | 0 |

The production JS increased by 2,054 bytes (approximately 2.06 kB; gzip display
increase 0.58 kB). Existing >500 kB chunk and LF-to-CRLF warnings remain. The
other 311 tracked/nonignored files match the start-of-task SHA-256 inventory
byte-for-byte, including clinical data and previous dialogue/logging work.
Generated outputs were not edited. Nothing was staged or committed.

```powershell
backend\.venv\Scripts\python.exe backend\server.py
```

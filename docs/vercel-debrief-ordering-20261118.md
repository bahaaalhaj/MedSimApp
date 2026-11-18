# Debrief preparation transaction conflict — 2026-11-18

## Demonstrated cause

`requestDebrief()` previously dispatched examination, every prescription,
diagnosis and completion writes with `Promise.all` for a single attempt.
The production Redis store takes an exclusive five-second, token-owned
transaction lock and immediately rejects overlap. A later failed promise did
not cancel the other writes. Consequently preparation could partly succeed
and fail before `/api/local-ai/evaluate` was ever reached.

The reproduction uses disposable loopback Redis 6.0.16, production Lua,
two separate application/store lifecycles and real HTTP routes. An event gate
holds the first prescription at commit, modeling request/transport scheduling
overlap without a sleep or a modified production lease. These endpoints then
each return HTTP 409 with `Encounter update in progress. Try again shortly.`:

- `POST /api/attempts/{attemptId}/prescriptions` (second prescription)
- `POST /api/attempts/{attemptId}/diagnosis`
- `POST /api/attempts/{attemptId}/completion`

After releasing the first write, exactly one prescription is saved; diagnosis,
completion and evaluation are absent, `evaluationActive` is false and pending
dialogue receipts are empty. This establishes a preparation conflict; it does
not establish which request failed first in the student's historical cloud
session, for which no request-correlated cloud trace was supplied.

Distinct protections remain tested:

| Condition | Endpoint/result |
| --- | --- |
| Short transaction busy | Preparation/recovery: 409 `Encounter update in progress. Try again shortly.` |
| Transaction lost its lease/revision fence | 409 `Encounter update lease expired. Recover and try again.`; stale write cannot commit/release its successor |
| Logical evaluation already active | Evaluation: 409 `An evaluation is already in progress for this encounter.` |
| Patient reply awaiting reconciliation | Evaluation: 409 `Patient text is still pending delivery...` |

## Scoped correction

- A browser-local FIFO per attempt serializes action APIs, result-release GETs,
  recovery and dialogue acknowledgements, retaining the slot until the response
  body is consumed. Different encounters remain independent. Queued aborted
  operations are not dispatched; a failure rejects its caller and does not
  permanently poison the queue.
- Complete outstanding investigation order/result workflows are tracked across
  their existing availability wait. Debrief drains prior encounter work and
  observes its failures even when a UI handler has already handled its rejection.
- Debrief awaits each required historical examination record, prescription,
  diagnosis and completion in order, then drains relevant remaining work before
  evaluation. A failed required write prevents grading. A manual retry reuses
  the original prescription fields/timestamps, rather than creating new evidence.
- Concurrent debrief callers in the same browser are ordered. Cached evaluation
  returns immediately; pending evaluation uses the existing abort-aware recovery
  poll. A cross-instance evaluation claim during preparation/evaluation is
  recovered without another evaluate POST. If a pending evaluation ends without
  a result, the client asks for a manual retry instead of automatically grading.
- Ordinary transaction-busy/expired-lease errors remain failures when recovery
  finds no result. They are not treated as an evaluation or silently retried.
- The second same-attempt `Promise.all` in investigation-result refresh is now
  sequential. Rapid panel-order submissions also use the shared operation queue.
  Unrelated saved-history deletion is unchanged.
- Existing prescription replay now succeeds at the 64-record limit; a new 65th
  prescription is still rejected. Diagnosis replay retains its original submission
  timestamp and completion remains an idempotent assignment.

Redis locks, ownership, fixed expiry, revision fencing and logical leases are
unchanged. No sleeps, provider retries, deadline/model/configuration changes or
clinical/scoring changes were introduced. New assessments remain raw 85 points.
Windows audio, SQLite and local configuration are untouched.

## Verification

- Frontend: 165 tests pass, including multiple prescriptions plus diagnosis and
  completion, partial failure/manual retry, body-consumption ordering, background
  work/failure drainage, concurrent callers, pending/cached recovery, conflict
  categories, cancellation and independent attempts.
- Real Redis suite: 16 tests pass, including owner isolation, cross-instance lock
  exclusion, stale fencing, pending delivery, partial preparation/replay,
  prescription-limit replay and cached 85-point evaluation.
- One test bundles the **actual TypeScript debrief client** and runs it through
  disposable HTTP into real Redis-backed routes. Three prescriptions, diagnosis
  and completion precede exactly one evaluation POST; the next call is recovery
  only and returns the same saved result. Its evaluator is scripted/offline.
- The final complete local backend suite passed all 310 tests, including the
  client/Redis integration. Local tools: Windows, Node 24.19.0, Python 3.12.2,
  Redis 6.0.16 in WSL. GitHub separately checks Ubuntu 24.04, Node 22.14.0,
  Python 3.12.8 and Redis 7.4. No hosted inference or evaluator completion was made.
- TypeScript, repository and clinical verification, official Vercel schema and
  packaging/routing contracts, security scans, ESLint, formatting and both
  production builds passed. Frontend clinical-truth scans passed for both outputs.
- Full Ruff on this existing working folder reports 13 findings in old **ignored**
  verification copies under `backend/data/ci-fix/`. They were preserved. Full Ruff
  passes on an export of the current tracked working files plus the new queue
  module, without those ignored copies and without adding exclusions.

Actual GitHub CI is checked after pushing and reported with the run URL in the
task response. This report does not claim a hosted student workflow passed.
No cloud configuration, active pilot or tunnel was changed. Remaining acceptance
is a protected Preview browser encounter with multiple prescriptions, diagnosis,
completion and debrief/recovery, using a fresh disposable guest attempt. Any
hosted inference for that check requires a separately bounded authorization.
Sequential preparation adds network round trips; the existing 12-second browser
debrief deadline is unchanged. Its adequacy on Preview remains to be measured.

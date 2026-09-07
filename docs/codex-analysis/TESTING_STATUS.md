# Testing Status

## Executed during this audit

| Check | Result |
| --- | --- |
| `node scripts/verify/run-all.ts` | PASS: data integrity, triage priority, 3D scene check, rubric citations |
| `node scripts/test/run-all.ts` | PASS: 18/18 tests |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | PASS |
| Vite production build to a temporary output | FAIL before compilation: archived `node_modules` lacks `@rollup/rollup-linux-x64-gnu` |
| `python -m unittest discover -s backend/tests -v` | NOT RUN: import failed because FastAPI is not installed in the supplied runtime/archive |

No source or dependency file was changed to resolve environment failures.

## Existing coverage

### Deterministic verification

- Cross-references among cases, tests, treatments, diagnosis options, and medication indications.
- Unique case IDs and critical-treatment subset rule.
- A narrow ER severity invariant for stable cases.
- Polyclinic scene constants/sentinel import check; the file itself notes that full mesh bounds are not tested.
- Guideline-reference resolution and authored/auto rubric selection.

### Node tests

- Custom-tool permission completeness and input validation.
- Frontend/backend custom-tool name parity by source text.
- Loop command and verify-log behavior.

### Python tests (present, not executed here)

- Triage model choice, prompt contents, request formatting, JSON parsing/error handling, and mocked HTTP endpoint.
- Fake EHR response shape, error cases, token non-disclosure, and tool registration.

`backend/smoke_test.py` is a live integration script for health, bootstrap/session/events/stream and requires a running configured backend/provider services. It was not run.

## Missing high-risk coverage

- React component and browser E2E tests.
- Full case-selection/encounter/dispatch/debrief workflow.
- Evidence completeness: voice transcript, checklist, prescriptions, and treatments reaching grading.
- Scoring arithmetic validation against emitted criterion results.
- `gradePrescription()` unit tests and integration; it is currently unused.
- Managed Agent event-shape contract and schema parity beyond tool names.
- SSE reconnect races, duplicate events, abort, and long idle streams in a browser.
- LiveKit room/token/worker integration and farewell RPC.
- Authentication bypass, admin-route exposure, rate limits, CORS, and body limits.
- `localStorage` migrations/corruption/quota behavior.
- 3D visual regression, collision geometry, accessibility, mobile/touch, and performance.
- Clinical-content review and learner-safety outcomes.
- CI configuration; none exists.

## Minimum checks by change type

- Any TypeScript: type-check and Node tests.
- Data/types/store: also `npm run verify`.
- Agent/tool/debrief: both suites plus mocked end-to-end event stream.
- Backend: Python tests in the configured backend environment.
- Voice: backend tests plus a LiveKit sandbox call.
- Scene: build and manual room inspection from multiple angles.
- Clinical rule: deterministic checks plus physician review.

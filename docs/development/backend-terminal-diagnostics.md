# Backend terminal diagnostics

Start MedSim in your own terminal from the repository root:

```powershell
backend\.venv\Scripts\python.exe backend\server.py
```

Diagnostics are automatic on stderr; no new environment variables or packages.
They also work when importing the app through an ASGI launcher. Existing Uvicorn
access logs remain unchanged. A process launched with stderr redirected to a
file writes there, not into a different terminal. Restart an already-running
backend to load this change; a restart clears its in-memory consultation attempts.

## What is reported

- `patient-response-failed`: provider errors, timeouts, and rejected semantic
  output, including errors delivered inside an HTTP 200 SSE stream.
- `http-request-rejected`: HTTP 4xx/5xx responses, including authentication,
  validation, ownership, missing/expired attempts, and application rate limits.
- `http-request-failed`: uncaught request/stream exceptions, re-raised unchanged.
- `evaluation-fallback`: unavailable/invalid enrichment; deterministic scoring
  still runs exactly as before.
- `tts-response-failed`, `tts-preload-failed`, `tts-preparation-failed`,
  `tts-cache-write-failed`, `tts-fallback`: speech/preload/background preparation
  and optional persistence/fallback failures. Successful speech is not discarded.
- `provider-health-unavailable` / `tts-health-failed`: an existing health check
  reports an unavailable provider. Logging does not add health/provider requests.
- `background-task-failed`: unhandled asyncio errors while application lifespan
  is active. The previous loop handler is restored on shutdown.
- `backend-started`, `backend-stopped`, `backend-lifecycle-failed`: lifecycle.
- `patient-response-cancelled`: informational cancellation, not a clinical error.

One JSON line per event includes a UTC timestamp and severity. Normal successes
do not produce extra diagnostics. A TTS failure may produce a domain diagnostic
and an HTTP 503 diagnostic; these describe one request, not repeated synthesis.
Expected HTTP rejections are warnings; uncaught exceptions/HTTP 5xx are errors.

Illustrative fields (not a new live hosted test):

```json
{"level":"WARNING","event":"patient-response-failed","requestId":"fdc6de71-41be-4aa2-838c-a9aa0c12527b","category":"rate-limited","upstreamStatus":429,"retryable":true,"durationMs":123.4,"validation":"semantic-provider-failed"}
```

`requestId` matches the existing patient/TTS request payload when it is a UUID.
Non-UUID IDs are logged as a stable truncated SHA-256 digest, not raw untrusted
input. Every HTTP request also has an internal `serverRequestId` tying domain
events to HTTP failures. It does not add/change API headers or response fields.
HTTP diagnostics use route templates, never raw resource IDs or query strings.
Semantic validation reasons distinguish rejected output from transport failures.
An HTTP 429 alone does not distinguish a daily quota from per-minute/upstream
limits; no automatic account lookup or inference retry is performed.

## Privacy and boundaries

The new logger records no question/answer, transcript, clinical truth, email,
password/hash, cookie, authorization/API key, raw provider body, or exception
message. Exceptions include only type and up to eight stack locations (basename,
line, function), without locals, source text, absolute user paths, or chained
messages. Category and validation values are allowlisted. Root/HTTPX/evidence
logging is not enabled or reconfigured.

This is not a guarantee to capture every failure: errors before application
creation retain Python/Uvicorn's ordinary startup diagnostics; native crashes,
forced termination, browser-only failures, and third-party internal warnings
are outside this logger. Existing third-party/Uvicorn logs are not globally
redacted by it. Logs are local stderr, not a persistent audit store or alerting
service. Do not publish an entire terminal log without reviewing it.

No clinical data, scoring rules, schemas, response statuses/bodies, cookies,
provider choice/deadlines, retry policy, TTS voices/queues/cache semantics, or
frontend behavior is intentionally changed.

## Verification

New tests use scripted provider errors and mocked TTS; they do not call hosted
completion endpoints or load/download voice models:

```powershell
backend\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p test_diagnostic_logging.py -v
backend\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
node node_modules/typescript/bin/tsc -b
npm test
npm run verify
npm run build
npm run security:scan
npm run security:scan-frontend
git diff --check
```

Tests cover stderr configuration/deduplication, secret/injection suppression,
HTTP contract/route privacy, SSE errors/re-raising, concurrent context isolation,
lifespan/background failures and handler restoration, provider error categories,
invalid semantic output, unchanged failure evidence, evaluation fallback, and
TTS failure/cleanup without model loading. Full browser interaction and a real
hosted error are not claimed by these offline tests.

## Implementation and verified results (2026-10-16)

Created:

- `backend/medsim_backend/diagnostic_logging.py`: dedicated stderr logger and
  body-free ASGI observer; no provider imports or additional model requests.
- `backend/tests/test_diagnostic_logging.py`: 15 focused offline regressions.
- `docs/development/backend-terminal-diagnostics.md`: this guide/report.

Modified only at existing diagnostic/failure boundaries:

- `backend/medsim_backend/application.py`: logger/middleware setup and scoped
  asyncio/lifespan error observation; existing middleware relative order retained.
- `backend/medsim_backend/services/patient_dialogue_service.py`: caught SSE
  provider/validation/cancellation errors now visible; existing framing and
  evidence/retry paths unchanged.
- `backend/medsim_backend/services/evaluation_service.py`: report enrichment
  fallback without changing deterministic evaluation.
- `backend/medsim_backend/routes/diagnostics.py`: report failed health and TTS
  operations without changing response contracts.
- `backend/medsim_backend/services/attempt_service.py`: retrieve/report failed
  audio-preparation task exceptions while retaining existing task cleanup.
- `backend/tts/providers.py`: report previously swallowed preparation/cache
  failures; existing queues, voices, cache, fallback, and cancellation unchanged.

No files deleted, moved or archived. No new dependency, environment setting,
database schema, clinical-data edit, commit, push, or live-backend restart.
The other 314 tracked/nonignored worktree files matched the start-of-task SHA-256
inventory byte-for-byte after verification; unrelated user changes were preserved.

| Check | Actual result | Exit |
| --- | --- | --- |
| Backend baseline before implementation | 180 passed, 99.430 seconds | 0 |
| Final backend unittest discovery | 195 passed, 119.680 seconds | 0 |
| New logging coverage | 15 tests included in the final backend run | 0 |
| Frontend `npm test` | 104 passed | 0 |
| Standalone TypeScript `tsc -b` | Passed | 0 |
| `npm run verify` | All 4 checks passed | 0 |
| `npm run build` | Passed; unchanged 1,549.38 kB JS / 425.54 kB gzip | 0 |
| Clinical validation/references/audit/curation/investigations | 72 assignable, 168 archived, 422 investigation records; 72 reference rows / 66 references | 0 each |
| `clinical:verify-generated` | Outputs current and semantically reproducible | 0 |
| `security:scan` | 288 tracked paths passed | 0 |
| `security:scan-frontend` | 0 of 292 protected truth strings exposed | 0 |
| `git diff --check` | Passed | 0 |

The pre-implementation new-test run failed as expected because the diagnostic
module did not yet exist. A separate temporary Uvicorn process then verified a
real localhost HTTP request with a **scripted** 429: HTTP 200 SSE preserved,
`patient-response-failed` / `rate-limited` / upstream 429 / matching UUID printed
on stderr, and no failed-turn transcript evidence. It shut down cleanly and
used a temporary database and disabled TTS. Zero hosted completions were sent.

Existing large-bundle and Git LF-to-CRLF warnings remain. Tests deliberately
trigger warnings/errors, including cache writes rejected for fake WAV fixtures;
those logs are expected test diagnostics, not reported live production failures.
This confirms software behavior only, not clinical validation/accreditation.

Manual next step: restart the existing backend in your own terminal and start a
fresh consultation. The current running process was deliberately left untouched;
browser/audio playback and a real hosted failure after restart remain unverified.

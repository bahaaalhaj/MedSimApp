# Verified TLS startup preparation and two-turn acceptance — 2026-10-29

Continues the [previous pooling acceptance](hosted-pooling-acceptance-20261029.md)
from `34598c0`, retaining the CI and lifecycle-pooling fixes.

## Implementation

The hosted provider's owned connection lifespan now prepares the verified TLS
trust context before yielding application readiness. HTTP clients, DNS, TCP,
TLS handshakes and completions remain lazy. This performs local trust-store
loading only, with no network, catalogue, evaluator or inference warmup.
Local providers and injected test transports skip hosted trust preparation.

The same helper serves startup and standalone client creation, preserving
HTTPX's CA policy and `SSL_CERT_FILE` / `SSL_CERT_DIR` change detection. A newly
constructed or cached context must require certificates and hostname checking.
Invalid contexts are rejected; verification is never disabled. Failed replacements
do not overwrite the previously cached certificate-environment identity.
Existing pooled clients retain their captured configuration until replacement or
a new lifespan, as before. Standalone clients still prepare trust lazily and do
not acquire cross-event-loop connection sharing.

Preparation failure aborts startup with a non-retryable `configuration-invalid`
error and the safe message “Hosted TLS trust preparation failed. Check the server
certificate configuration.” The original exception chain, potentially containing
private certificate paths, is suppressed. The existing redacted lifecycle logger
records the category and stack locations without exception messages. No ready
event or HTTP client follows failure. Both ownership markers are cleared, and
the wrapper fails closed until an explicit new lifecycle. Successful preparation
logs `hosted-tls-context-prepared` with its numeric duration.

Per-request deadlines, inference serialization, cancellation, response cleanup,
connection limits/expiry, cookie rejection and shutdown remain in place. The
production budget stays **3.0 seconds inner / 3.2 seconds total semantic**.
The pinned model, zero-price caps, disabled reasoning and provider fallback,
credentials, records, clinical content and scoring were not changed.

## Offline evidence before live execution

All **46 focused Windows tests** passed: six new startup tests, 28 existing hosted
diagnostic/reliability tests and 12 pooling tests. Full Ruff passed. The scripted
diagnostic also completed two grounded terminal turns, with no live inference.
Injected scripted transports intentionally skip actual trust-store preparation;
the separate startup tests exercise the normal provider and real context factory.

Coverage establishes:

- Real trust-store loading performs no DNS/connect calls and constructs no client.
- The first real owner-bound dialogue route uses the exact prepared context;
  the factory is called once, and subsequent turns use the same managed client.
- Certificate/hostname verification is enabled; an invalid certificate file or
  deliberately unverified context aborts startup without fallback or path leakage.
- Failure restores the event-loop handler and releases provider/application
  ownership; a retained failed owner cannot dispatch an unmanaged request.
- Repeated application lifecycles get separate preparation and current certificate
  environment. Standalone cache invalidation covers both certificate variables.
- Local and injected-transport lifespans make no hosted preparation/model calls.
- Existing keep-alive, stale-connection, cancellation, loop-ownership and failed-SSE
  assertions remain intact. Missing upstream model identity remains unconfirmed
  even when the API reports the configured model and emits a grounded `done`.

The diagnostic now reports `groundedAnswerAndDone` independently from
`upstreamModelIdentityConfirmed`. Its existing corrected inspection reads only
HTTPX's already-read decoded body, including compressed responses; it performs no
extra read and never substitutes the requested model for missing upstream identity.
The compatibility SSE `actualModel` field is reported separately and is not
independent evidence. Startup timings and zero-network guards are recorded before
the guard is removed for the two explicitly authorized turns.

## Actual live startup and both attempts

The run occurred approximately **17:31:28–17:31:36 UTC / 20:31:28–20:31:36 Baghdad**
in one isolated application lifespan/event loop, using temporary SQLite, fresh
guest sessions/encounters and fresh request IDs. Both turns used the existing
semantic-only outdoor-marks question for `id-004`; no cached or deterministic
answer counts as hosted success. No TTS/evaluator/public server was started.

Startup measurements:

| Measurement | Actual result |
| --- | ---: |
| Verified trust-context preparation | **1273.338 ms** |
| Application lifespan entry, including preparation | **1275.404 ms** |
| Startup DNS/socket-connect attempts | **0**, guarded against calls |
| Completion requests at startup | **0** |
| Context prepared before first turn | **Yes** |
| Client/connection precreated during startup | **No** |

All following durations are milliseconds. A dash means the phase was not reached,
not zero latency. Cancelled spans are censored observations, not eventual setup
time estimates.

| Measurement | Fresh connection | Subsequent, pool eligible |
| --- | ---: | ---: |
| **Full route duration** | **3061.350** | **3050.682** |
| Local preparation | 28.489 | 15.371 |
| Prompt construction | 0.141 | 0.141 |
| Provider gate wait | 0.067 | 0.041 |
| HTTP client construction | 203.968 | No new client |
| DNS + TCP connect | **2798.769, cancelled** | 1349.276, complete |
| TLS handshake | — | **1664.210, cancelled** |
| HTTP request headers/body written | **No** | **No** |
| Response-header wait / receipt | — | — |
| Response-body receipt | — | — |
| Interpretation / grounding validation | — | — |
| Terminal SSE error, from request start | 3058.408 | 3048.866 |
| SSE EOF, from request start | 3059.352 | 3049.480 |
| Application HTTP / upstream HTTP | 200 / none | 200 / none |
| Grounded answer and successful terminal done | **No** | **No** |
| Successful done events | **0** | **0** |
| Upstream-confirmed model identity | **Unobserved** | **Unobserved** |
| New TCP connection attempted | **Yes** | **Yes** |
| Actual connection reuse | **No** | **No** |
| Transcript entries / scoring action IDs added | **0 / 0** | **0 / 0** |

Both errors were `response-timeout`. The first failed before TCP setup completed;
the second reached TLS but did not complete it. Neither sent an upstream HTTP
request, received headers, ran grounding validation or emitted `done`. There is
no answer or upstream model identity to confirm. Application HTTP 200 is only
the SSE envelope, not success.

The same client/pool was available for turn two, but the first never established
a reusable connection. Both traces show new connection setup; turn two therefore
did not reuse a connection. Neither produced a completed network-stream identity.
The pool was confirmed closed on shutdown. Exactly **two route/SDK attempts** were
reserved and used; the pre-connection dispatch counter does not prove that the
provider received either request. Both failed attempts exhaust this authorization.
No retry, metadata request, evaluator call, paid fallback, timeout/model change
or additional completion attempt followed. There was no quota/configuration
response to trigger early stop, because no response was reached.

The configured secret/API key/session settings and actual database/sidecar
hashes/presence were checked unchanged. Only temporary encounters were removed.
No MedSim/ngrok listener was present before execution, no existing service was
restarted, and no tunnel was launched. Private timing-only evidence is preserved
outside Git and frontend delivery:
`%LOCALAPPDATA%/MedSim/hosted-dialogue/tls-startup-3p0-3p2-live-20261029.json`.

## Remaining acceptance work

Trust preparation is now measured separately from patient-turn time, but the
remaining failures are **before HTTP**, in connection establishment. This sample
does not measure provider response wait, queueing or model inference at all.
It does not show that a larger inference deadline or a different model would
resolve the observed DNS/TCP/TLS variability.

The next practical investigation needs a separately bounded **non-completion**
network budget to distinguish resolver/address selection, TCP establishment and
TLS timing on this Windows/network path. The previous connection study already
showed variable setup; instrument those phases before spending more completions.
Do not weaken certificate checks or change system DNS/proxy/security settings.

After connection behavior is understood, a new explicitly authorized two-turn
acceptance should use these unchanged deadlines and corrected decoded identity
check. Require grounded text, exactly one `done`, upstream-confirmed pinned model
and transport evidence of actual reuse on the subsequent turn. A failed first
connection cannot establish reuse. Student concurrency, browser/ngrok/HTTPS
delivery and optional audio still need separate pilot acceptance. Two successful
turns would remain a smoke test, not evidence of long-term reliability.

## Final local verification

| Check | Actual result |
| --- | --- |
| Windows startup / hosted / pooling tests before live | **6 + 28 + 12 passed**; startup suite 6.207 seconds, hosted suite 6.555 seconds, pooling suite 9.986 seconds |
| Final scripted diagnostic | **2/2** grounded answers and independently confirmed scripted model identities; startup network guards, pool shutdown and protected-file checks passed |
| Clean Linux worktree at `34598c0` plus scoped changes | Ubuntu 22.04, Node **22.14.0**, Python **3.12.8**; fresh lockfile installation, no private config/records or copied dependencies |
| Full backend suite | **280 passed**, 191.517 seconds |
| Full frontend suite | **138 passed** |
| Type-check, repository verification, clinical validation/curation/investigations/generated artifacts | Passed |
| Full backend/tool Ruff, ESLint, Prettier, tracked security scan and diff integrity | Passed |
| Production build / frontend clinical-truth scan | Passed; **0 of 292** protected strings exposed; existing Vite chunk-size warning remains |
| Live semantic acceptance | **0/2**; both pre-HTTP timeouts retained, no answer/model identity/done/reuse established |

Only scoped code, tests and sanitized documentation are committed. Private
diagnostic evidence, secrets, databases and logs remain excluded. The pushed
commit and actual GitHub Actions result are reported in the handoff; local
passes alone are not a claim that CI or live hosted dialogue passed.

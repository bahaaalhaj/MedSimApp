# Two-turn hosted pooling acceptance — 2026-10-29

Follow-up to the [connection study and lifecycle pooling](hosted-connection-study-20261029.md)
at `3299be1`, preserving the CI fixes at `9e04fed`.

## Observed outcome

Exactly **two new semantic-dialogue attempts** ran through the real owner-bound
`/agent/patient/stream` route in one isolated FastAPI lifespan and event loop.
The cold request timed out. The subsequent request delivered a grounded answer
and exactly one successful terminal `done`, reporting the pinned model, but
opened a **new connection**. This run does **not** establish live connection
reuse or reliable hosted dialogue at the current deadlines.

The production limits remained **3.0 seconds inner / 3.2 seconds total semantic**.
The model remained `nvidia/nemotron-3.5-super-vl:free`, with reasoning disabled,
provider fallback disabled and prompt/completion/request price caps all zero.
No retry, inference warmup, evaluator, metadata request, paid fallback, local
language-model start or additional live attempt followed. Both attempts count
against the authorization, including the failure.

## Every live attempt

The sequence ran approximately **16:58:04–16:58:09 UTC / 19:58:04–19:58:09 Baghdad**.
All durations below are milliseconds; times marked “from start” include preceding
local work. A dash means the phase was not reached, rather than zero latency.

| Measurement | Cold | Subsequent, pool eligible |
| --- | ---: | ---: |
| **Actual route duration** | **3053.981** | **1471.056** |
| Local preparation | 27.276 | 20.800 |
| Prompt construction | 0.161 | 0.152 |
| Provider gate wait | 0.047 | 0.054 |
| Client / verified trust-context construction | 1155.681 | No new client |
| DNS + TCP connect span | 452.675 | 213.551 |
| Verified TLS handshake | 253.875 | 225.260 |
| Wait for upstream response headers after write | 737.501 | 511.109 |
| Upstream body receive span | 399.898, cancelled | 483.957, complete |
| First transport body byte, from start | 2835.456 | 1190.258 |
| Interpretation / grounding validation | — | 1.104 |
| Terminal SSE, from start | 3051.891, **error** | 1469.788, **done** |
| SSE EOF, from start | 3052.549 | 1470.114 |
| Application HTTP / upstream HTTP | 200 / 200 | 200 / 200 |
| Successful terminal done events | **0** | **1** |
| Reported actual model | None | Pinned NVIDIA model |
| Validation result | semantic-provider-failed | valid-semantic-answer |
| Disposable transcript entries added | 0 | 2 |
| Predefined scoring action IDs awarded | 0 | 0 |

The cold turn received headers and 21 transport body bytes before cancellation;
it never obtained a complete answer or model identity. Its terminal event was
`response-timeout`, with no `done` or clinical evidence. HTTP 200 was not success.
Cancellation closed the incomplete response. The second turn received a full
body, passed the existing grounding validator and emitted text followed by one
`done`, with no error, truncation or later SSE frame.

**Transport evidence disproves reuse on turn two:** both turns emitted new
`connection.connect_tcp` and `connection.start_tls` events. HTTPcore's opaque
network-stream identities mapped to distinct diagnostic connection IDs **1**
and **2**. Turn two reused the same client/pool and cached verified trust context,
but its connection was newly established after the first response was cancelled.
The client was confirmed closed at application shutdown. Eligibility is not
claimed as connection reuse.

DNS and TCP are combined in this trace. The response-header wait combines network
transit, routing, provider queueing and possibly inference; those components
cannot be separated here. Body timing observes transport chunks, potentially
including compression or provider padding, rather than a model token timestamp.
Cancelled durations are censored, not estimates of eventual completion time.

## Diagnostic limitations and fixes

The old diagnostic intentionally ran without a lifespan and substituted a
provider directly in the dialogue module. The new opt-in `--pooled-acceptance`
mode instead installs an isolated provider factory and uses the actual FastAPI
lifespan plus request middleware binding. It refuses changed deadlines, a changed
model or combination with the older 4.8/5.0 experiment. Its fixed sequence has
two turns; route attempts and outbound completion reservations are persisted
before dispatch. Fresh encounters, guest cookie jars and request IDs prevent
cached or deterministic dialogue from serving as hosted evidence.

Before live execution, request hooks were corrected to select each outgoing
request's timing object. Previously a pooled client's hooks would retain the
first turn's timing. Only numeric spans, allowlisted categories and synthetic
connection IDs are serialized; raw stream objects, bodies, prompts, answers,
headers, cookies, addresses and exception messages are not written to reports.

An additional conservative upstream JSON model-identity check was introduced
before the live run. **It did not record a result on the second live response**,
so the original report's `successfulTerminalSSE` flag is **false**, despite its
recorded grounded answer, pinned SSE `actualModel` and one `done`. The production
provider can substitute the configured model when an upstream body omits its
model field; therefore SSE identity alone does not independently prove that field
was present. Full strict identity acceptance remains inconclusive for turn two.

Offline investigation reproduced a diagnostic defect: inspecting raw compressed
transport bytes as JSON misses model identity and embedded quota codes. The tool
now inspects HTTPX's already-read, decoded response body without another network
read, and records whether content encoding was present. Gzip regression coverage
passes. The original live trace did not retain the encoding or decoded identity,
so compression is a demonstrated possible explanation, not a proven diagnosis of
that particular response. The original private report is preserved; its flag was
not rewritten, and no third attempt was spent to repair the observation.

The default unmanaged diagnostic and separate four-attempt timeout experiment
remain available with their existing budgets. No production provider, deadline,
clinical rule, scoring weight, frontend or configuration was changed here.

## Isolation and next practical step

The CLI checked for existing MedSim listeners before starting. It opened no
public or local server socket, used temporary SQLite and disposable in-memory
encounters, disabled audio startup only in this isolated lifespan, and did not
invoke readiness or evaluation routes. Configuration/database hashes and
sidecar presence were verified unchanged. No active pilot was restarted and
ngrok was not launched. Timing evidence remains outside Git and frontend delivery:
`%LOCALAPPDATA%/MedSim/hosted-dialogue/pooled-3p0-3p2-live-20261029.json`.

The measured cold bottleneck includes **1156 ms of local verified trust-context
construction**, leaving only about 400 ms for the body after headers arrived.
There is no evidence of material local preparation or gate delay, and no
confirmed production pooling defect. A practical next change to evaluate offline
is constructing only the verified SSL context during application startup, with
no network or inference warmup. This moves a measured local cost out of the
student turn while keeping the request deadlines, model and verification policy
unchanged. It has **not** been applied or authorized by this report.

After that decision and offline verification, the minimal live acceptance still
needs a **new explicit two-attempt budget** through the same owner-bound route:
one cold connection and one subsequent turn, using the corrected identity check.
Require a complete first response before expecting a reusable connection, inspect
stream identity and new-connect traces, and retain failures if it closes again.
No further attempt is authorized by this task. One short successful response
shows that an answer can arrive within the budget; two turns cannot establish
long-term reliability or prove that pooling reduces provider inference delays.

## Actual verification

| Check | Result |
| --- | --- |
| Windows focused diagnostic tests | **16 passed**, 6.402 seconds |
| Final scripted pooled CLI | **2/2** grounded terminal turns; no live inference; shutdown and protected-file checks passed |
| Clean Linux worktree at `3299be1` plus scoped changes | Ubuntu 22.04, Node **22.14.0**, Python **3.12.8**; no private config, records or copied dependencies |
| Full backend suite | **274 passed**, 164.000 seconds, including five new diagnostic regressions and existing real loopback pooling tests |
| Frontend suite | **138 passed** |
| Type-check, repository verification, clinical validation/curation/investigations/generated artifacts | Passed |
| Full backend/tool Ruff, ESLint, Prettier, tracked security scan, staged/diff integrity | Passed |
| Production build / frontend clinical-truth scan | Passed; **0 of 292** protected strings exposed; existing Vite chunk-size warning remains |
| Live requests in this task | Exactly **2 completion attempts**, zero metadata/evaluator calls, zero retries |

Only the diagnostic, its tests and sanitized reports are included in the scoped
commit. Actual GitHub Actions status and the pushed commit are reported in the
handoff; these local results alone are not a claim that GitHub Actions passed.
No browser/ngrok/mobile-audio acceptance or long-term reliability is implied.

# Non-completion connection study and scoped pooling — 2026-10-29

This continues the [four-attempt timeout experiment](hosted-timeout-experiment-20261029.md)
from `11816ce`, retaining the intervening CI fixes at `9e04fed`. No new live
model completion, evaluator call, retry, model selection or deadline experiment
was authorized or performed. Production remains **3.0 seconds inner / 3.2
seconds total semantic**, with the same pinned free NVIDIA model and zero-price
safeguards. No active pilot was restarted or public tunnel started.

## Six-request Windows connectivity study

Exactly six HTTPS GET attempts reached the configured `openrouter.ai` host's
documented [model-count endpoint](https://openrouter.ai/docs/api/api-reference/models/get-total-count-of-available-models):
`https://openrouter.ai/api/v1/models/count`. This endpoint reads metadata and
does not request inference. Every attempt returned HTTP 200 and a valid count
schema (22 response bytes). No failure, redirect or retry occurred. The request
counter was saved before each dispatch. No additional provider request followed.

The fixed order alternated a fresh client with one shared client, waiting two
seconds after each response. Both modes used the same verified SSL context;
its initial construction took **1196.630 ms**, measured separately from the
table. Each fresh client closed after its one request; the shared client closed
after the sequence. Idle expiry was 30 seconds. GETs had an isolated 10-second
diagnostic deadline; this does not change any production deadline.

All measurements below are milliseconds. A dash means no new connection phase
was observed on a reused connection; it is not an invented zero duration.

| Attempt | Client/connection | Resolver call | Connect span, including DNS | Verified TLS | Wait for headers | Body read | HTTP total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Fresh | 261.217 | 480.069 | 336.851 | 386.257 | 192.816 | 1600.549 |
| 2 | Shared, first connection | 1.937 | 275.288 | 321.248 | 504.454 | 275.191 | 1380.382 |
| 3 | Fresh | 1.628 | 469.996 | 621.577 | 505.958 | 421.608 | 2022.872 |
| 4 | Shared, reused | — | — | — | 2242.267 | 0.547 | 2247.393 |
| 5 | Fresh | 20.275 | 1246.027 | 776.367 | 1564.165 | 440.389 | 4030.395 |
| 6 | Shared, reused | — | — | — | 659.046 | 474.846 | 1137.562 |

Resolver duration observes the normal `socket.getaddrinfo` call, including OS
resolver/cache behavior. HTTPcore's connect span includes resolver/thread
scheduling, TCP establishment and possible address selection. These nested
measurements must not be added together or interpreted as separately measured
TCP packet transit. HTTP totals start immediately before each request; event
timestamps also include preceding client selection/report persistence. Phase
spans omit local backend setup/scheduling and need not sum to the total. Raw trace info,
addresses, cookies, authorization headers and response content were discarded.
Certificate and hostname verification stayed enabled; system DNS, proxies,
firewall and security settings were not changed.

Two reused requests avoided a new DNS/TCP/TLS setup. Reuse still produced a
**2242 ms header wait** on one metadata request. Fresh total times ranged from
1.60 to 4.03 seconds. Six temporally ordered metadata requests are not a stable
latency distribution, randomized comparison, concurrency test or estimate of
completion latency. **Endpoint reachability does not establish model latency.**
Pooling cannot fix provider queueing or inference delays; neither was measured.

Private timing-only evidence is outside Git and frontend delivery:
`%LOCALAPPDATA%/MedSim/hosted-dialogue/connectivity-six-get-20261029.json`.
`backend/provider_connectivity.py` implements the opt-in, fixed-six GET study;
existing report names are refused, authentication/rate failures stop early,
and the URL/method cannot be changed to a completion endpoint. Re-running its
live mode requires a new explicit request budget. Offline tests use MockTransport.

## Application and standalone ownership

The old verified-context optimization remains. The production FastAPI lifespan
now owns a new provider wrapper, serialization gate and lazy HTTP client for
each application lifecycle. A pure ASGI middleware binds that owner through a
ContextVar while routing and streaming, because the ASGI lifespan task's context
does not automatically become the request task's context. Background grading
inherits the request's provider context. Another app/lifecycle gets another
owner; overlapping lifespans on the same app are rejected.

The OpenRouter completion pool retains at most one connection and one idle connection,
with 30-second idle expiry. HTTPX stays on its existing HTTP/1.1 defaults and
verified CA/hostname policy. Client/context construction remains lazy, inside
the existing request deadline. No startup HTTPS or inference warmup is added.
Managed clients capture CA/proxy configuration when created; a new lifecycle is
needed to refresh it. Unmanaged client creation retains certificate-environment
change detection. No certificate or proxy setting was changed in this task.
Catalogue/readiness requests retain their existing short-lived clients and
retry policy, so a slow metadata response cannot occupy the sole completion
connection while another student's patient turn is waiting.
See HTTPX's [async ownership](https://www.python-httpx.org/async/) and
[pool limits](https://www.python-httpx.org/advanced/resource-limits/) documentation.

Each operation explicitly supplies its own timeout: a prior evaluator request
cannot lend its longer timeout to a patient turn. The existing outer semantic
deadline still includes queue wait, and one patient/evaluator operation enters
the inference gate at a time. Normal responses are read/closed by HTTPX; its
0.28.1 send path also closes partial responses on body exceptions/cancellation.
Shutdown cancels tracked active/queued provider calls, waits for their cleanup,
then closes the client in the owning loop. A retained closed request context
fails explicitly instead of opening an unmanaged replacement client.

Only the existing server-owned authorization/title/request-ID headers are sent.
No incoming learner cookies or identity headers are forwarded. A rejecting
cookie-jar policy prevents provider Set-Cookie values from carrying across turns.
Prompts remain per request; no learner content is stored in client defaults.

Expired/known-closed idle connections may be replaced before dispatch. A failure
after a POST reaches a reused connection is reported as a provider failure with
no automatic replay. Transport retries remain HTTPX's default zero. Protocol
errors now map to the existing `model-unavailable` category. No new completion
retry, fallback, redirect or duplicate-request mechanism was introduced. The
existing optional catalogue retry policy was not expanded or invoked live here.

Standalone calls and ASGI tests without an application lifespan keep short-lived
clients. Tools wanting pooling can explicitly own a `SerializingLocalLLMProvider`
with `async with provider.lifespan(): ...` in one event loop. Separate
`asyncio.run()` scopes create fresh clients/gates; cross-loop access to an active
owner is rejected. Injected transports must use a per-application provider
factory so they are never silently discarded or shared across app owners.
The older timeout diagnostic remains unmanaged by default and therefore does
not implicitly gain pooling or consume another completion budget.

## Verification and next live acceptance

New offline tests exercise real loopback HTTP keep-alive, idle disconnects,
dropped reused connections without duplicate POSTs, partial-body cancellation,
cancelled queue waiters, shutdown, absolute/per-operation deadlines, cookie and
request-ID isolation, separate/repeated application lifecycles, cross-loop
rejection, standalone multi-loop calls, and real-route terminal SSE failures.
A failed SSE remains HTTP 200 with an error and **no done**, transcript, action
credit or saved answer. Diagnostic tests cover the six-GET cap, fixed URL,
spacing, report redaction/reuse refusal and early stop. No model assets are used.

| Final local check | Actual result |
| --- | --- |
| Clean Linux worktree based on `9e04fed`, Node 22.14.0 / Python 3.12.8 | Ubuntu 22.04; no private config, database, model assets or copied dependencies |
| Backend suite, including 15 new connectivity/lifecycle tests | **269 passed**, 142.994 seconds |
| Windows focused connectivity/lifecycle tests | **15 passed**, 8.917 seconds |
| Frontend suite | **138 passed** |
| Type-check, repository, clinical validation/curation/investigations/generated artifacts | Passed |
| Full backend/tool Ruff, ESLint, Prettier, tracked security scan, diff integrity | Passed |
| Production build and frontend truth scan | Passed; **0 of 292** protected strings exposed; existing Vite chunk warning remains |
| Live provider requests in this task | Exactly **6 metadata GETs**, **0 completions**, **0 retries** |

Actual GitHub Actions results are reported with the pushed commit in the task
handoff. Passing offline checks is not a successful live model turn or proof
that the previous timeout is solved. The production frontend, clinical
artifacts/content, scoring, local credentials/configuration and records were
not edited. The existing CI workflow and pinned dependencies remain unchanged.

The next minimal live acceptance needs a **new authorization for two semantic
completion attempts**: one cold and one subsequent request through the same
isolated application lifecycle, at the unchanged 3.0/3.2-second deadlines and
same pinned model. Use disposable records, disable evaluator/TTS only in that
isolated instance, and add per-request allowlisted network tracing to observe
whether the second request actually reuses its connection. No automatic retry
or extra readiness/catalogue call is needed. Require a grounded validated
answer, text and exactly one terminal done for each success; record every error
and full duration, and stop on quota/rate/configuration errors. Two successes
would be an acceptance smoke test, not proof of long-term reliability.

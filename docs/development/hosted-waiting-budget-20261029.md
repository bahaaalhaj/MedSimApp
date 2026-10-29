# Isolated 7.8/8.0-second semantic waiting experiment — 2026-10-29

Continues from `bfeb714e974e978dc85fa659987e45514a874deb` and the
[TLS startup report](hosted-tls-startup-20261029.md). This task paused further
network tracing and tested a practical waiting budget. Production provider,
route, frontend, deadlines and ignored configuration were not changed.

## Scope and diagnostic changes

`backend/hosted_dialogue_diagnostic.py --experiment-7p8-8p0` replaces only the
isolated settings instance's patient timeout (7.8 seconds) and semantic timeout
(8.0 seconds). It refuses a different pinned model or production baseline other
than 3.0/3.2. The default, previous four-turn experiment and two-turn pooled
acceptance modes retain their own limits. CLI modes are mutually exclusive.

The new mode makes six sequential turns in one actual application/provider
lifespan and event loop. Three fixed questions repeat in the same order; each
turn creates a fresh owner-bound encounter/session and UUID request ID. There
is no application dialogue cache reuse or carried patient conversation context.
The provider pool can reuse its connection across these separate encounters.
The local ASGI diagnostic client has a 10-second HTTPX setting; ASGITransport
itself does not enforce socket timeouts. Actual provider/outer cancellation
is enforced by the existing server asyncio deadlines. The real browser SSE
reader has no independent short timer and is tested separately below.

The dispatch budget is persisted before each provider send; a seventh send is
blocked before transport. Request hooks enforce the unchanged pinned model,
disabled reasoning, disabled provider fallback and zero price caps. No
completion retry, metadata, quota, evaluator, inference warmup or TTS request is
made. Startup's DNS/socket guard is removed only after verified local trust
preparation and zero startup dispatch are confirmed. No public listener exists.

Each row now checks both normal grounding validation and the expected fact and
answer content for its question. It reports failure category and actual reuse
separately. A valid answer to a different fact fails this diagnostic. Reuse
requires the same opaque transport-stream identity seen on an earlier turn
without a new TCP connection; pool eligibility alone is insufficient. Missing
evidence is unknown, rather than claimed reuse. Reports retain only safe status,
timings and synthetic stream IDs, never credentials, prompts, answer bodies,
headers, raw transport objects or exception messages.

## Offline verification before live execution

The Windows focused backend suite passed **23 tests in 28.675 seconds**. New
coverage verifies isolated settings differ in exactly two deadline fields,
three distinct questions/cases repeated twice through real semantic routes,
fresh upstream request IDs, explicit 7.8-second HTTPX limits, one managed client,
shutdown, and blocking the seventh send. A scripted first answer waits 3.4
seconds and still completes, demonstrating no old 3.2-second outer clamp.

An actual 7.8-second stalled-body timeout closes the response, releases the gate,
emits an error without `done`, and adds no evidence. An actual 8.0-second outer
queue timeout cancels before dispatch and releases the gate. Explicit
cancellation closes the body and removes only the disposable attempt. Existing
compressed-body identity, missing-model, HTTP-200 quota, failure retention,
SSE truncation/duplicate-terminal and early-stop regressions continue to pass.

Three new frontend tests bundle the real SSE parser, request function and
cancellation owner without modifying them. A scripted response remains pending
for 8.05 seconds, then completes only on `done`; partial text is not a completed
answer. Explicit cancellation interrupts the pending read and unlocks the reader
without retry. Timeout SSE and HTTP-200 EOF without `done` remain failures.
All **3 passed**; the delayed case took **8202.240 ms** on Windows.

The complete offline CLI rehearsal produced **6/6 scripted semantic successes**,
exactly six dispatches, zero startup network attempts and zero startup
completions, with clean pool shutdown and unchanged protected files. Scripted
identity/reuse evidence is test evidence only, not a live provider result.

## All six authorized live turns

Execution was approximately **19:42:44–19:42:59 UTC / 22:42:44–22:42:59 Baghdad**,
after verifying there were no MedSim/ngrok listeners on 8787, 8788 or 4040.
It used temporary SQLite and disposable encounters, not saved student records.
The laptop's currently selected network was used without switching or inspecting
network settings; the preceding task had a user-confirmed hotspot connection.
The network's identity was not independently rechecked in this task.

| Question | Case | Semantic wording |
| --- | --- | --- |
| A | card-003 | What happens to your breathing when you are horizontal in bed? |
| B | id-004 | Tell me about those marks after your outdoor weekend. |
| C | im-003 | Have you been using any pills from home? |

All answer-content checks ran in memory against authored case facts; clinical
answer bodies are not copied into the public report. Every row had one hosted
completion dispatch, `valid-semantic-answer`, the expected fact/content, a
complete grounded answer, exactly one successful terminal `done`, no trailing
frames, and completed SSE EOF. **There were no failed or cancelled live turns**
in this bounded run. No rows were omitted, retried or replaced.

Configured identity remained **`nvidia/nemotron-3.5-super-vl:free`**. Independently,
the already-read decoded upstream JSON explicitly contained that same model
identity on **all six** turns. Every response was compressed; the corrected
HTTPX decoded-body inspection handled each without an additional read. The SSE
`actualModel` also matched, but is not used as independent upstream evidence.

| Turn | Question | Full route ms | Grounded answer + done | Upstream model confirmed | Connection reused | Failure |
| --- | --- | ---: | --- | --- | --- | --- |
| 1 | A | 3233.126 | Yes, exactly 1 | Yes | No, fresh TCP/TLS | None |
| 2 | B | 1712.112 | Yes, exactly 1 | Yes | Yes | None |
| 3 | C | 6761.907 | Yes, exactly 1 | Yes | Yes | None |
| 4 | A | 818.946 | Yes, exactly 1 | Yes | Yes | None |
| 5 | B | 1320.311 | Yes, exactly 1 | Yes | Yes | None |
| 6 | C | 1609.474 | Yes, exactly 1 | Yes | Yes | None |

All turns had the same transport-stream identity. The first had new TCP and TLS
events; turns 2–6 had HTTP send/receive events on that stream with no new TCP/TLS.
This is actual reuse evidence. Separate learner cookies/identities remained on
the local owner-bound requests; the provider's existing cookie rejection and
server-only credential policy were unchanged.

Startup local verified trust preparation took **1029.638 ms**, and application
lifespan entry **1030.567 ms**. There were **zero** startup outbound attempts or
completions, and no precreated HTTP client/connection. The pool closed on shutdown.
Configuration and real database/sidecar hashes and presence were unchanged.

All following phases are milliseconds. TCP includes resolver/address selection;
DNS is not separately measured. No extra low-level probes were made. Header/body
waits include network and provider behavior; provider queue and model execution
cannot be separated from these traces. Reuse means TCP/TLS were unnecessary,
not a zero-cost newly established connection.

| Turn | Local preparation | Gate wait | TCP | TLS | Response-header wait | Response body | Validation | Terminal SSE offset |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 33.242 | 0.038 | 628.008 | 661.133 | 693.214 | 1020.021 | 1.836 | 3231.334 |
| 2 | 18.236 | 0.042 | Reused | Reused | 549.970 | 1124.510 | 0.381 | 1710.240 |
| 3 | 19.478 | 0.032 | Reused | Reused | 6723.333 | 0.655 | 0.271 | 6760.278 |
| 4 | 17.440 | 0.033 | Reused | Reused | 508.603 | 270.583 | 0.475 | 816.981 |
| 5 | 18.194 | 0.038 | Reused | Reused | 1056.202 | 226.078 | 0.358 | 1317.964 |
| 6 | 14.680 | 0.033 | Reused | Reused | 524.100 | 1048.791 | 0.245 | 1608.335 |

Cold HTTP client construction took **159.095 ms**, prompt construction
0.132–0.232 ms. The slowest turn spent almost all its time waiting for response
headers on an already reused connection. Pooling therefore does not eliminate
provider response variability or establish a bound on model execution.

Private timing-only evidence, excluded from Git and frontend delivery, is at
`%LOCALAPPDATA%/MedSim/hosted-dialogue/waiting-7p8-8p0-live-20261029.json`.
This authorization is exhausted: exactly **six** SDK/route attempts and **six**
upstream completion sends, with no additional provider requests.

## Recommendation and remaining acceptance

**7.8/8.0 is a reasonable candidate for a small supervised pilot with one active
semantic turn at a time**, subject to explicit later production adoption and a
browser/HTTPS pilot check. The longest observed full route was 6.762 seconds,
leaving about one second of inner provider headroom in that turn. Compared with
the unchanged production budget, this permits up to 4.8 seconds more hosted wait
before reporting a timeout. The total semantic budget includes gate waiting, so
overlapping learners could exhaust it while queued; this six-turn sequential
study did not test concurrent students. It is not an exact eight-second bound
on the whole browser interaction: local preparation, validation, SSE delivery
and optional audio add overhead outside the semantic wait.

These six successes are a smoke test, not proof of long-term reliability, a
stable p95, or performance across the full case catalogue. No historical run
success rates are compared as controlled experiments. Third-party caching,
provider queueing and inference timing are not observable independently here.
There was no client cache replay or deterministic shortcut: every turn made its
own semantic completion and passed server grounding validation.

Production remains **3.0/3.2**, with the same model, zero-price caps and fallback
policy. No ignored configuration, clinical facts, scoring, real records, public
tunnel or active student service was changed. The next work is a deliberate
adoption decision followed by a minimal real-browser/HTTPS text/cancel/recovery
check and supervised concurrency planning. No further live attempts or tracing
are part of this task. If real pilot waits become unacceptable, practical options
are to limit simultaneous semantic turns, use existing authored History controls
during the supervised session, or defer hosted chat and gather UI feedback first;
changing providers or models would require a separate explicit decision.

## Repository verification

The full workflow was reproduced in a fresh Linux worktree at `bfeb714` plus
only these scoped files, using a fresh lockfile dependency installation, Node
**22.14.0** and Python **3.12.8**. The local distribution is Ubuntu **22.04**;
GitHub's actual Ubuntu **24.04** run must pass independently after push.
No ignored configuration, saved records, private diagnostics or Windows
`node_modules` were copied into that worktree.

| Check | Actual local result |
| --- | --- |
| Complete backend suite | **287 passed**, 181.168 seconds |
| Complete frontend suite | **141 passed**, 27.385 seconds |
| TypeScript / repository verification | Passed / all 4 repository checks passed |
| Clinical validation, curation, investigations, generated artifacts | All passed |
| Full backend/tool Ruff, ESLint, Prettier | All passed |
| Tracked secret/runtime-artifact scan | Passed, 380 tracked paths |
| Production build | Passed, 16.31 seconds; existing large-chunk warning remains |
| Production frontend truth-leakage scan | **0 of 292** protected strings exposed |
| Staged and unstaged diff integrity | Passed |
| Isolated live semantic experiment | **6/6**, all independent model/grounding/done checks passed |

The pushed commit and actual GitHub Actions result are recorded in the task
handoff; local passes alone are not a CI claim. Private measurements, runtime
artifacts and local secrets remain outside the scoped commit.

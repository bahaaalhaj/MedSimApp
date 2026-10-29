# Isolated 4.8 / 5.0 second experiment — 2026-10-29

## Outcome and recommendation

The explicitly approved four-attempt experiment completed **2 grounded answers
and 2 timeouts** using the unchanged pinned model
`nvidia/nemotron-3.5-super-vl:free`. Both successes passed
`valid-semantic-answer`, returned that model identity, delivered text and exactly
one terminal `done`. Both failures were application HTTP 200 SSE streams ending
with `response-timeout` and **no `done`**. HTTP 200 alone was never success.

**Do not adopt 4.8 / 5.0 seconds as a reliability fix yet.** It allowed answers
taking 3.570 and 4.793 seconds through, but two of four attempts still failed.
The maximum permitted wait increases by **1.8 seconds** compared with the current
3.0 / 3.2 second limits. This small sample, one question and an isolated queue do
not establish long-term reliability, representative case coverage or student-load
performance. The earlier 0/2 run occurred at a different time; this is not a
randomized or contemporaneous comparison of success rates.

Production defaults and ignored local configuration remain **3.0 / 3.2 seconds**.
The rotated shared secret, credentials, other settings, clinical facts, scoring,
saved records and provider safeguards were preserved. No pilot/ngrok listener
was running, no active student session was restarted and no public tunnel began.

## Method and bounded authorization

The current diagnostic gained an explicit `--experiment-4p8-5p0` mode. It uses
`dataclasses.replace` to change only the isolated provider instance's inner limit
to **4.8 seconds** and the diagnostic route's total semantic limit to **5.0
seconds**. The normally configured settings object, environment timeout values,
production code/defaults and `.env.local` are not edited. Its default mode still
has the original two-attempt cap and configured deadlines.

Exactly **four new SDK completion attempts** were reserved and sent: one fresh
provider instance followed by three uses of that instance's cached verified SSL
context. Each turn used a fresh disposable encounter, the same unchanged
outdoor-marks question for `id-004`, the original prompt/validator, and the real
owner-bound ASGI route. The shared provider queue was uncontended. Warm-context
means cached TLS trust configuration, **not a reused TCP/TLS connection**.

The calls ran around **17:28:26–17:28:44 Baghdad / 14:28:26–14:28:44 UTC**.
There were no automatic retries, evaluator calls, catalogue/quota queries, paid
fallbacks, model changes or local-model/TTS starts. No extra live attempt followed
these four. No quota/rate/configuration condition occurred to trigger early stop.
The CLI's final exit **2** correctly reports a run containing failed turns.

## Every attempt and duration

Durations are observed application/ASGI request durations, including local
preparation, provider wait and SSE completion; browser/ngrok delivery was not
tested. All values below are milliseconds.

| Measurement | Cold | Warm-context 1 | Warm-context 2 | Warm-context 3 |
| --- | ---: | ---: | ---: | ---: |
| **Actual request duration** | **4793.479** | **3569.537** | **4837.593** | **4840.959** |
| Local preparation | 32.638 | 34.843 | 18.629 | 20.170 |
| Prompt construction | 0.215 | 0.174 | 2.437 | 0.199 |
| Provider queue | 0.022 | 0.020 | 0.022 | 0.016 |
| HTTPS client / trust-context construction | 1480.936 | 0.580 | 0.768 | 1.213 |
| DNS + TCP connect | 861.567 | 437.668 | 1434.141 | 1289.183 |
| TLS handshake / verification | 359.882 | 1098.688 | 804.866 | 3510.398, cancelled |
| Await response headers after request write | 634.127 | 1927.203 | 2551.445, cancelled | Not reached |
| Upstream body receive span | 1382.491 | 43.119 | Not reached | Not reached |
| First upstream body byte, from request start | 4051.694 | 3563.352 | Not reached | Not reached |
| Grounding / interpretation validation | 2.554 | 0.380 | Not reached | Not reached |
| Terminal SSE, from request start | 4792.246, **done** | 3567.466, **done** | 4835.428, **error** | 4837.317, **error** |
| SSE EOF, from request start | 4792.590 | 3567.919 | 4835.969 | 4838.067 |
| Upstream HTTP headers received | 200 | 200 | None | None |
| Patient transcript entries added in temporary encounter | 2 | 2 | 0 | 0 |
| Scoring question IDs awarded | 0 | 0 | 0 | 0 |

Failure details:

- **Warm-context 2:** TCP and TLS completed, the request was fully written, and
  waiting for response headers consumed 2551.445 ms before the inner deadline
  cancelled it. No upstream body, model identity or interpretation was available.
- **Warm-context 3:** DNS/TCP completed, but TLS did not finish before cancellation
  after 3510.398 ms in that phase. No upstream HTTP request or response was reached.

Cancelled spans are censored observations, not completion-time estimates. DNS
and TCP are combined by the current trace. TLS includes verification. Waiting
for headers combines transit, OpenRouter/provider routing/queue and possibly
inference; the data cannot separate those components. No duration is fabricated
for unexecuted validation. Successful replies selected allowed active-case facts;
typed semantic assistance did not award predefined-question action IDs.

## Next investigation

The evidence argues against repeatedly raising the deadline:

1. Run a separately bounded **non-completion** DNS/TCP/TLS reachability study to
   the configured host, separating resolver time and connection establishment
   where possible. TLS varied from 0.360 seconds to more than 3.510 seconds even
   with the trust context warm. Investigate that variance before inferring a
   model-speed problem; retain certificate and hostname verification.
2. Evaluate lifecycle-managed HTTP connection reuse with offline keep-alive,
   cancellation and cross-event-loop tests. The current client closes a fresh
   TCP/TLS connection every turn. Reuse could reduce repeated setup, but is not
   implemented or claimed as a verified fix by this experiment.
3. If connection behavior is stable but response-header waits remain long,
   investigate provider routing/queue/inference using safely allowlisted upstream
   identifiers/timings under a new explicit diagnostic budget. The second failure
   shows that TLS is not the sole possible delay. No additional model, retry or
   timeout experiment is implicitly authorized here.

## Tool safeguards and regression coverage

The fixed sequence is one cold and three warm-context attempts; the attempt
counter is persisted before dispatch and refuses a fifth call. There is no
unbounded timeout or attempt-count CLI option. The experimental mode refuses a
different pinned model. It stops early on quota, rate-limit or configuration
categories/status codes, including a numeric quota error embedded in HTTP 200
JSON. Only a bounded in-memory body is inspected for that numeric error code;
messages, prompts, answers, headers and credentials are not recorded.

The tool now also records every request's actual duration, failed validation
category when available, first non-whitespace body receipt, and a redacted
diagnostic-error row before stopping on unexpected diagnostic failures.

Before live execution, **11 focused tests passed**, including new coverage for:

- Only two isolated timeout fields change; the original plan/settings stay intact.
- Four calls use 4.8 seconds; a fifth is blocked before transport dispatch.
- Early stop on HTTP 401/402/403/429 and embedded HTTP-200 rate-limit errors.
- Timeout failures remain in the report; unexpected failures retain duration
  without exposing their exception messages.

The scripted CLI also passed **4/4** grounded terminal-SSE turns with controlled
provider and queue delays. Those are tool/endpoint checks, not hosted evidence.
The live preservation check verified configuration and actual SQLite hashes and
sidecar presence unchanged. Reports remain outside Git and the served frontend:

- `%LOCALAPPDATA%/MedSim/hosted-dialogue/timeout-4p8-5p0-live-20261029.json`
- `%LOCALAPPDATA%/MedSim/hosted-dialogue/timeout-4p8-5p0-offline-20261029.json`

Offline reproduction with a fresh report filename:

```powershell
.\backend\.venv\Scripts\python.exe -B .\backend\hosted_dialogue_diagnostic.py --experiment-4p8-5p0 --output "$env:LOCALAPPDATA/MedSim/hosted-dialogue/NEW-4p8-offline.json"
```

Adding `--live` spends up to four attempts. The current task's authorization is
exhausted; that command must not be rerun live without a new explicit budget.

## Final verification

| Check | Actual result |
| --- | --- |
| Backend offline suite | **254 passed**, 123.338 seconds; temporary SQLite and blocked external Python networking |
| Focused diagnostic tests before live | **11 passed** |
| Scripted experimental CLI | **4/4** validated terminal SSE turns, zero live completions |
| Frontend tests | **132 passed** |
| Type-check / production build | Passed; existing >500 kB Vite chunk warning remains |
| Repository verification | All **4** checks passed |
| Production frontend clinical-truth scan | **0 of 292** protected strings exposed |
| Scoped Ruff / diff whitespace | Passed |
| Staged secret/artifact checks | Passed; only diagnostic code/tests and reports staged |
| Live preservation / budget check | Configuration and actual database unchanged; exactly four attempts, no retries |

No browser HTTPS/audio or ngrok acceptance is implied by these checks. Automated
passes do not turn either live timeout into a successful patient response.

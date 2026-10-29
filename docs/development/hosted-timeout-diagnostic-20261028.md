# Hosted dialogue timeout diagnostic — 2026-10-28

Follow-up: [approved isolated 4.8 / 5.0 experiment on 2026-10-29](hosted-timeout-experiment-20261029.md).
The measurements and two-attempt authorization below describe the earlier run.

## Finding

The configured `nvidia/nemotron-3.5-super-vl:free` path completed **0/2** new live
diagnostic attempts within the unchanged **3.0 s inner / 3.2 s semantic** budgets.
Both application responses were HTTP 200 SSE streams ending in
`error/category=response-timeout`, with **no `done` event**. They are failures.
Neither attempt obtained upstream response headers or a complete model reply.
Model-only inference speed therefore remains unknown; these results establish
failure of the current end-to-end budget on this machine/network at that time.

No timeout, model, fallback, credential, clinical, scoring, session or audio
configuration was changed. No additional live completion is authorized by this
run: the two-attempt limit was exhausted. No retry, evaluator call, catalogue
completion loop, paid model, local model, ngrok or active-pilot restart occurred.

## Prior evidence and current path

The retained 2026-10-28 pilot log reports request
`c787b6ad-acf1-4230-bc45-049389bcf984`, server request
`c24a8306-d3d1-47c9-b51a-80cf1db182fc`, failing after **3035.252 ms** at
13:53:22 UTC (16:53:22 Baghdad). Its browser evidence explicitly has
`http=200`, `done=false`, `category=response-timeout`, `actualModel=null`.
The stack identifies the inner `OpenRouterLLMProvider.complete_chat` timeout.
It does not identify that request's individual network phases or retain its
question in this report. The optional evaluator timeout is a separate operation.

The [2026-10-16 follow-up](hosted-dialogue-reliability.md#sarah-white-timeout-follow-up-2026-10-16)
had received upstream HTTP 200 headers before a body-read timeout. That historical
observation must not be substituted for the new connection-stage failures.
It also already fixed repeated CA-context construction; that correction remains.

The traced path is:

1. Frontend `streamLocalPatient` posts an owner-bound typed question to
   `/agent/patient/stream`; it requires a terminal `done` and reports stream errors.
2. Backend authorization and `PatientDialogueService.stream` derive patient-safe
   memory, retrieval and deterministic routing. No clinical content was edited.
3. An ambiguous typed question builds `interpretation_prompt`, then waits on the
   single shared patient/evaluator semaphore inside the 3.2 s outer wait.
4. `OpenRouterLLMProvider.complete_chat` gives the single configured model 3.0 s,
   including HTTPS client construction, DNS/TCP, TLS, request write and the full
   non-streaming upstream response. Reasoning is disabled, price caps are zero,
   and fallback routing/retries are absent for completions.
5. A complete reply is parsed and validated against allowed case facts; the server
   composes authored text, records evidence, and emits text followed by `done`.
   A provider failure instead emits an error, releases the active flag and adds
   no patient turn, replayed answer or scoring action.

The provider retains its verified SSL context but creates/closes an async HTTP
client for each call. Consequently TLS context reuse does **not** mean TCP/TLS
connection reuse. This is existing behavior, not a newly demonstrated correctness
regression. A persistent connection pool would need separate lifecycle and
cross-event-loop work; this investigation does not introduce that change.

## Measurements

Before live calls, offline HTTPS client construction (no network request) measured
**1092.164 ms cold**, then **0.496 / 0.244 ms warm**. No process environment proxy
or certificate override was set. Installed HTTPX/HTTPCore were 0.28.1/1.0.9.

The two live calls ran at approximately **23:41 Baghdad / 20:41 UTC**, using the
same unchanged outdoor-marks paraphrase for `id-004`, fresh disposable attempts,
one cold provider instance followed by reuse of that instance's SSL context.
They did not use the host's saved records, app lifespan or TTS runtime.

| Phase, milliseconds | Cold attempt | Warm-context attempt |
| --- | ---: | ---: |
| Local request preparation | 27.900 | 19.628 |
| Interpretation prompt construction | 0.143 | 0.151 |
| Shared provider queue wait | 0.016 | 0.028 |
| HTTPS client / CA-context construction | 1447.226 | 0.548 |
| DNS + TCP connect | 1567.304, cancelled | 699.506, completed |
| TLS handshake + verification | Not reached | 1450.890, completed |
| Request headers/body write | Not reached | 1.825, completed |
| Awaiting upstream response headers | Not reached | 842.973, cancelled |
| Upstream response body / interpretation validation | Not reached | Not reached |
| Provider call including teardown | 3018.312 | 3007.884 |
| Application terminal **error** SSE, from request start | 3059.965 | 3045.199 |
| Application SSE EOF, from request start | 3060.391 | 3045.724 |

Cancelled spans are elapsed time **until cancellation**, not the time needed to
complete the phase. DNS cannot be separated from TCP in the captured connect
trace; TLS includes certificate verification. Header wait combines network,
OpenRouter routing/provider queue and possible inference; none can be isolated
without an upstream response. Body read and model-validation durations are
unavailable, not zero. Queue contention was negligible in these isolated runs;
this does not establish queue behavior under simultaneous student/evaluator load.

The first attempt reserved a completion attempt but never wrote an upstream HTTP
request. The second wrote its request but received no response headers before
cancellation. The tool conservatively counts **two reserved/dispatched SDK
attempts** against the cap, not two successful or necessarily billable inferences.
It neither queries quota to infer request counts nor makes another completion.

## Timeout decision for review

**Keep the current configuration unchanged in this task.** There is no new
evidence that the configured model itself can or cannot finish in three seconds
once connected; historically it sometimes did, and sometimes did not.

If a longer, separately approved diagnostic is desired, the recommended first
experiment is **4.8 s inner / 5.0 s total**. At the measured warm connection cost
of about 2.15 s, that would leave about **2.65 s** for response headers/body instead
of **0.85 s**, at a cost of **1.8 s more maximum wait per failed turn**. The same
model, zero-price constraints and no-retry policy should remain. This is an
experiment recommendation, **not a measured production reliability improvement**
or permission to run more live calls. Cold connect completion and model response
time are censored here; five seconds could still fail. Production adoption needs
the user's decision and a separately budgeted end-to-end validation.

## Code and offline verification

Added `backend/hosted_dialogue_diagnostic.py`: a standalone, opt-in diagnostic
using the real owner-bound route, queue, provider and validation. Normal server
code and serialized encounter/history contracts are unchanged; no new production
correctness defect was demonstrated. The added tool addresses the missing phase
visibility that prevented attribution from the older aggregate latency field.

- Default mode blocks non-loopback Python networking and uses scripted responses.
- Live mode reserves at most two completion attempts and persists the counter
  before dispatch. It refuses existing local MedSim listeners and report-file
  reuse. No model/deadline is substituted or enlarged.
- Trace callbacks retain only allowlisted event names, durations and status.
  They discard raw trace `info`, headers, URLs, exception messages, prompts and
  answers. Reports must be outside the repository and are not served.
- Success requires text, exactly one terminal `done`, no error/truncation/late
  frames, a validated semantic answer and the configured model identity.
- Local preparation, prompt construction, queueing, client setup, network phases,
  validation and terminal/EOF emission are measured separately where reached.
  SSE timestamps observe actual ASGI body sends, not HTTPX's buffered ASGI client
  return; they do not establish browser/ngrok wire behavior.
- Real local config/database hashes and sidecar presence are checked unchanged.
  The rotated shared secret and all credentials remain in ignored local config.

Six new offline tests cover phase separation/redaction, upstream HTTP 200 with
body timeout, outer queue cancellation without dispatch/evidence, a persisted
two-attempt cap including a third endpoint call blocked before transport, and
terminal/truncation/late-frame handling. The scripted CLI also completed **2/2**
validated terminal SSE turns with controlled provider-body and queue delays.
That is endpoint/tool verification, not live model success.

Private timing-only reports:

- `%LOCALAPPDATA%/MedSim/hosted-dialogue/timeout-diagnostic-live-20261028.json`
- `%LOCALAPPDATA%/MedSim/hosted-dialogue/timeout-diagnostic-offline-final-20261028.json`

Reproduce **offline** from the repository root with a fresh output filename:

```powershell
.\backend\.venv\Scripts\python.exe -B .\backend\hosted_dialogue_diagnostic.py --output "$env:LOCALAPPDATA/MedSim/hosted-dialogue/NEW-offline-diagnostic.json"
```

Adding `--live` consumes up to two live attempts; do not do so again under the
exhausted budget for this task. The old 12-request benchmark is not an alternative
within this budget.

Final checks on the resulting source:

| Check | Actual result |
| --- | --- |
| Backend offline suite | **249 passed**, including six new diagnostic tests; 131.780 s |
| Frontend suite | **132 passed** |
| Type-check / production build | Passed; existing >500 kB Vite chunk warning remains |
| Repository verification | All **4** checks passed |
| Production clinical-truth scan | **0 of 292** protected strings exposed |
| Scoped Ruff / whitespace checks | Passed |
| Tracked/staged secret and runtime-artifact checks | Passed; private reports/config/database excluded |
| Isolated live tool preservation check | Local configuration, database bytes and sidecar presence unchanged |

No pilot/backend/ngrok listener was present before or after the investigation;
no student session was restarted. Live HTTPS/browser/audio/provider success
remains unestablished. The live failures remain failures despite all offline
regression/build checks passing.

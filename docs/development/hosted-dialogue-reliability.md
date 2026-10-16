# Hosted patient-dialogue reliability

Measured locally on 2026-10-16, on `main` at
`584cfc732804fdb3653ad4d42e2774d85b5761b8` plus the existing uncommitted
history, semantic-dialogue, and optional local-runtime work. Nothing was committed
or pushed. These are technical observations, not clinical validation.

## Live comparison, separate from unit tests

Explicit primary: `nvidia/nemotron-3.5-super-vl:free`. Existing catalogue-price,
parameter-support, paid-blocking, and disabled-reasoning checks remain in force.
No model chain, retries, paid model, dynamic router, or clinical changes were used.

The opt-in `backend/hosted_deadline_benchmark.py` made **12 actual hosted completion
requests**, four per group, through the real owner-bound ASGI routes and grounding
validator. It does not start a second application lifespan or load another Kokoro.
The normal backend/Vite were running during the comparison. This is not a mock
transport and does not include browser/network rendering time.

| Total semantic budget | Inner hosted budget | Grounded successes | Timeouts | Other errors | Median | p95 |
|---|---|---|---|---|---|---|
| 3.2 s | 3.0 s | 4/4 (100%) | 0 | 0 | 2158.23 ms | 2217.81 ms |
| 5.0 s | 4.8 s | 4/4 (100%) | 0 | 0 | 2468.75 ms | 2595.53 ms |
| 8.0 s | 7.8 s | 4/4 (100%) | 0 | 0 | 2191.36 ms | 4245.31 ms |

Four unchanged smoke questions covered horizontal breathing (`card-003`), outdoor
skin marks (`id-004`), home medicines (`im-003`), and pediatric breathing medication
(`peds-002`). Every trial used a fresh attempt and the same variant seed. Group
orders were counterbalanced: 3.2/5/8, 5/8/3.2, 8/3.2/5, 8/5/3.2. Starts were at
least four seconds apart; rate-limit, capacity, and invalid-configuration errors
would stop the run, rather than trigger repeated requests. The key endpoint
reported 38 remaining free requests before the run, sufficient for the fixed 12.

Success required a completed turn, `valid-semantic-answer`, and expected authored
content. All 12 selected only allowed active-patient source IDs. Typed semantic
turns awarded no quick-question IDs. All returned the pinned NVIDIA model. The
model selected source IDs; server code composed the patient replies. Existing
scoring and fact-review requirements were not modified.

The predefined selection rule was the shortest budget with 4/4 grounded successes.
**Selected: 3.2 seconds total / 3 seconds inner.** There is no measured benefit here
to adopting a larger production deadline. The p95 is nearest-rank (with four
samples, the maximum); it is not a stable tail estimate. A 4.25-second observation
in the 8-second group demonstrates jitter: this small sample does not prove the
3.2-second setting will always succeed, nor establish a statistically significant
difference between settings. Prior intermittent failures remain relevant.

Private reports (not served or tracked):

- `%LOCALAPPDATA%/MedSim/hosted-dialogue/deadline-comparison.json`
- `%LOCALAPPDATA%/MedSim/hosted-dialogue/post-reliability-restart.json`

Reports contain synthetic answers and private source-selection audits; they are
not copied into frontend assets. No key or other credential is recorded.

## Explicit configuration decision

The ignored `backend/.env.local` now explicitly sets:

```env
OPENROUTER_PATIENT_TIMEOUT_SECONDS=3
OPENROUTER_SEMANTIC_TIMEOUT_SECONDS=3.2
```

The new total-budget setting makes controlled experiments possible; the former
hardcoded 3-second inner clamp no longer invalidates longer experiments. Both
defaults and the selected runtime budgets remain 3/3.2. Validation rejects
non-finite values, outer budgets outside 1–8 seconds, and inner budgets below
0.5 seconds or above outer minus 0.2 seconds. Local interpretation and the
separate 7-second optional evaluator deadline are unchanged. The existing API key,
model choice, provider flags, disabled fallback settings, and unrelated settings
were preserved. No local-model downloads or startup were performed.

Reproduce only when sufficient quota is available; this command consumes up to
12 completion requests, never retries, and requires an output outside the repo:

```powershell
backend/.venv/Scripts/python.exe backend/hosted_deadline_benchmark.py --live --output "$env:LOCALAPPDATA/MedSim/hosted-dialogue/deadline-comparison.json"
```

## Operational failure is not a patient answer

- Provider timeout, rate limit, unavailable service, and invalid/untrusted model
  output use the existing SSE `error/category/retryable/correlationId` framing.
  There is no patient-text or `done` event for these failed turns.
- Failures do not append patient messages, transcript, asked-question scoring IDs,
  response-cache answers, or dialogue context. Private diagnostics are bounded to
  16 failed request IDs per attempt. The active-request flag is released.
- Chat shows an accessible error and `Retry question`, retaining editable question
  text (also when reopening the tab). Submission is synchronously locked while
  pending. A manual retry of the same question uses the same request ID; successful
  replay is cached server-side. Failed turns cannot authorize evidence or queue
  patient speech. No automatic retry is introduced.
- EOF without a terminal `done` is a retryable interruption, not a partial clinical
  answer. The stream reader is cancelled/released on termination. Client transcript
  and audio commit only after a complete validated response.
- A validated semantic `unknown` or authored absence is still a clinical answer.
  A failed request must never be converted into that answer. A compound question
  with unresolved enrichment is retried as a whole on provider failure, rather than
  describing failed retrieval as missing clinical history.

After an environment-first backend restart, actual public HTTP checks returned:

| Check | Observed result | Latency |
|---|---|---|
| Outdoor-marks question | Authored tick/rash/travel answer, pinned model; same-ID replay identical | 2219.09 ms |
| Undocumented operation in 2019 | Validated `safe-unknown`, pinned model | 2230.35 ms |
| Protected diagnosis question | Deterministic refusal; no model | 19.81 ms |

These checks added two hosted completions, for **14 total** in this task, without
retries. The quota endpoint still reported 38 remaining afterward; its snapshot
did not immediately reflect these requests, so it is not used as an inference
counter. No live timeout or rate limit occurred in this small run. Failure-path
claims below come from regression tests, not invented live failures.

## Regression and safety checks

| Check | Result |
|---|---|
| Python unittest discovery | 166 passed; exit 0, including frozen evaluation fixtures |
| `npm test` | 104 passed; exit 0 |
| `node node_modules/typescript/bin/tsc -b` | Exit 0 |
| `npm run verify` | Exit 0 |
| `npm run build` | Exit 0; existing >500 kB chunk warning |
| Clinical validation, references, audit, curation, investigations | Exit 0; 72 assignable / 168 archived / 422 investigation records / 66 references |
| `npm run clinical:verify-generated` | Exit 0; outputs current and semantically reproducible |
| Memory report `--check` and history draft report `--check` | Exit 0 |
| Core-history review gate | Expected exit 2; zero missing domains, 446 still pending review |
| Repository and production frontend security scans | Exit 0; zero of 292 server-truth strings in production JavaScript |
| Expanded tracked + nonignored untracked text secret scan | Exit 0; the documented `.env.example` placeholder excluded; no secret-shaped values found |
| Targeted ESLint | Exit 0 |
| `git diff --check` | Exit 0; existing LF/CRLF conversion notices only |

A separate post-restart local TTS smoke used an original predefined question and
the existing audio endpoint: HTTP 200, valid RIFF/WAV, `af_bella`, persistent-cache
hit, 99.8 ms, 2.675 seconds of audio, initialization count 1, zero hosted
completions. This checks the cached audio path, not uncached synthesis or browser
playback. No TTS implementation, voice, cache semantics, or ordering was changed.

New backend tests cover matched experimental budgets, non-finite bounds, no hidden
3-second clamp, honest statistics including failures, provider/validation failures
without clinical turns, same-ID retry/replay once, and genuine clinical uncertainty.
Behavioral frontend tests exercise the actual bundled Conversation and SSE parser
with simulated failures/truncation and verify no evidence/audio until success,
stable retry ID, and exactly-once authorized-answer callbacks. Chat's error/draft/
lock controls have additional static characterization; React/browser rendering
and visual retry interaction have not been manually exercised.

**Hosted evaluator compatibility remains unverified.** No live evaluator request
was added to this experiment. Deterministic evaluation fallback and scoring
arithmetic were not changed; frozen fixtures still pass. Original history and all
446 pending clinical reviews remain unchanged. This is not medical validation.

## Change scope

Created:

- `backend/hosted_deadline_benchmark.py`
- `backend/tests/test_hosted_reliability.py`
- `docs/development/hosted-dialogue-reliability.md`

Modified, including files already changed by earlier work:

- `backend/.env.example`
- `backend/local_llm.py`
- `backend/medsim_backend/services/patient_dialogue_service.py`
- `backend/semantic_dialogue_smoke.py`
- `backend/tests/test_local_ai.py`
- `backend/tests/test_openrouter.py`
- `backend/tests/test_patient_memory.py`
- `backend/tests/test_patient_interpretation.py`
- `docs/local-ai-architecture.md`
- `src/components/examine/ChatTab.tsx`
- `src/voice/PatientTextRequestLifecycle.ts`
- `src/voice/conversation.ts`
- `src/voice/localPatient.ts`
- `src/voice/patientTextRequest.ts`
- `scripts/test/frontend-component-contract.test.ts`
- `scripts/test/patient-grounded-flow.test.ts`
- `scripts/test/runtime-polish.test.ts`

The ignored private `backend/.env.local` changed only the two explicit timeout
settings above; it is not staged. Of the 46 user-owned dirty paths recorded at
the start, 37 are byte-identical to their pre-task snapshots; the other nine
are listed above and contain the scoped additions. No files were moved, archived,
or deleted. No clinical, evaluator, store, scene, TTS implementation, or local-runtime
setup files were changed by this task. Existing unrelated work was preserved.

## Sarah White timeout follow-up (2026-10-16)

Browser request `fdc6de71-41be-4aa2-838c-a9aa0c12527b` showed 3.27 seconds
total, 3.26 seconds waiting for the server, and the application's timeout message.
Retained access logs did not include that correlation ID or failure phase, so its
exact inner-versus-outer timeout cannot be reconstructed from those logs alone.
HTTP 200 for the SSE transport does not establish a successful patient response.

Exactly one additional, separately identified diagnostic completion reproduced
the screenshot's `how are you ?` question for `id-004`, with the existing pinned
model and 3/3.2-second limits. Diagnostic ID:
`diagnostic-c4b9908e-e8cc-4d73-8add-07e540d57179`. It received upstream HTTP 200
headers but timed out while reading the response body. The actual provider error
category was `response-timeout`, raised by the inner hosted client; no full
interpretation was available to validate. This reproduction did not fail with
HTTP 401, 429, an unavailable-model HTTP status, or malformed interpretation JSON.
That does not prove the original request had the identical internal timing.

The diagnostic's 4.14-second process wall time includes its custom transport's
cold construction before the request's bounded wait. It is not directly comparable
with the browser's 3.27-second duration, and no deadline was increased. The probe
used a fresh serialization gate, so it does not reproduce prior gate contention.
No browser attempt, transcript, scoring evidence, or audio was mutated. There
were no retries or other hosted diagnostic completions in this follow-up.

Offline measurements then identified a concrete local contribution: constructing
a default HTTPX HTTPS client repeatedly took 1139.88, 890.34 and 891.74 ms, with
zero network requests. Rebuilding TLS trust configuration was consuming a material
part of the patient deadline, independently of model inference latency.

Targeted correction: the OpenRouter provider lazily retains HTTPX's default
verified SSL context and passes it to new, separately closed clients. This is
not persistent async-client/connection reuse, introduces no event-loop lifetime
coupling, and does not disable TLS. Certificate verification remains required,
hostname verification stays enabled, and the default CA/environment selection
comes from HTTPX's own context factory. Changing `SSL_CERT_FILE` or `SSL_CERT_DIR`
rebuilds the context. As with other retained trust contexts, restart the backend
after changing certificate-store contents in place. See the
[HTTPX SSL-context documentation](https://www.python-httpx.org/advanced/ssl/).

Using the implemented provider, offline client construction measured 1128.79 ms
cold, then 0.47 and 0.22 ms warm. Cold setup remains inside the existing patient
deadline, not exempted from it. A preceding catalogue check can warm the same
context. TCP/TLS connection establishment and provider response latency still
exist, so this correction cannot guarantee free-provider availability.

The model, request payloads, reasoning policy, price caps, no-chain policy,
3/3.2-second patient limits, and 7-second evaluator limit remain unchanged.
Hosted evaluator compatibility is still **unverified**. Clinical facts and the
446 pending reviews were not changed.

Changed for this correction: `backend/local_llm.py`, four TLS-context regression
tests in `backend/tests/test_hosted_reliability.py`, and this follow-up note.
The preceding startup-order correction in `backend/server.py` and its three
startup tests remain intact. No files were removed or moved; no private
configuration was changed in this follow-up.

Regression results: 173 backend tests and 104 frontend tests passed (exit 0),
including frozen scoring, duplicate-request/evidence/audio, safe retry, TLS
verification, lazy setup, certificate-environment refresh, and injected-transport
compatibility checks. TypeScript/production build, repository verification,
security scan, clinical validation/curation/investigations, history draft checks,
and `git diff --check` passed (exit 0). The only live completion in this follow-up
was the failed diagnostic above. Post-fix browser recovery and playback must be
verified separately; they are not established by the offline timing measurements.

Private reports, outside Git and frontend delivery:

- `%LOCALAPPDATA%/MedSim/hosted-dialogue/sarah-white-single-diagnostic.json`
- `%LOCALAPPDATA%/MedSim/hosted-dialogue/sarah-white-tls-setup-offline.json`

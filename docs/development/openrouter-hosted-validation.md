# Hosted semantic dialogue validation — 2026-10-16

## Outcome

Hosted configuration is restored and one real running-backend smoke run passed
**11/11**, with **11 authenticated hosted turns**, exit **0**. This is not a claim
of consistently reliable free service: separate private-audit runs passed only
1/11 and 3/11 because of timeouts/provider failures. All runs are retained below.
No patient deadline, semantic prompt, clinical fact, scoring rule or probe wording
was changed to obtain the passing result.

## Selection and actual compatibility

- Requested `google/gemma-4-26b-a4b-it`: exact catalogue entry exists but prices
  were prompt `0.00000009`, completion `0.0000003` USD/token. **Not selected**.
- `google/gemma-4-26b-a4b-it:free`: separate exact entry, prompt/completion `0`,
  context 262,144, optional reasoning, max tokens/temperature/JSON mode advertised.
  A real authenticated plain-JSON completion succeeded in 1,085.70 ms, cost 0,
  reasoning tokens 0. Subsequent patient requests encountered upstream **HTTP 429**
  from **Google AI Studio**; the diagnostic did not identify an account daily
  quota failure. A strict JSON-schema diagnostic returned HTTP 404. Its catalogue
  advertises JSON mode but not `structured_outputs`; these are not equivalent.
- Current explicit primary: `nvidia/nemotron-3.5-super-vl:free`. Catalogue and its
  NVIDIA endpoint both report prompt/completion prices `0`, context 1,000,000,
  optional reasoning and support for max tokens, temperature, response formatting
  and structured outputs. A real active-patient selection returned HTTP 200 in
  2,818.03 ms, cost 0, reasoning tokens 0, and validated permitted fact IDs.
- Liquid's `liquid/lfm-2.5-2.6b:free` was considered from metadata only and rejected
  because reasoning is mandatory; no completion was sent to it.

Sources: [OpenRouter model catalogue](https://openrouter.ai/api/v1/models),
[paid Gemma](https://openrouter.ai/google/gemma-4-26b-a4b-it),
[free Gemma](https://openrouter.ai/google/gemma-4-26b-a4b-it:free),
[selected NVIDIA model](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free),
[reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
[provider price limits](https://openrouter.ai/docs/guides/routing/provider-selection#max-price).
Catalogue availability/pricing is time-specific, not a 2027 availability promise.
Only synthetic case-local dialogue facts were used. The NVIDIA free endpoint
discloses logging; never send confidential or real patient information.

The current private environment explicitly selects OpenRouter, disables local LLM,
enables semantic dialogue and pins NVIDIA's exact free ID. Existing credentials
and unrelated settings were preserved. Stale fallback IDs were cleared; Pro
fallback and paid-model flags remain false. The allowlist retains old explicit
Nex IDs for compatibility plus the individually checked Gemma/NVIDIA free IDs.
There is no runtime model chain, random router or automatic paid substitution.
Requests now also enforce zero maximum prompt, completion and request prices.

All patient calls retain `reasoning.effort=none`, existing output bounds, 3-second
transport deadline and 3.2-second total semantic budget including the shared gate.
Server membership/protection/schema validation still owns acceptance and composes
patient text from authored sources. The separately configured general 7-second
deadline was used only for explicitly identified schema diagnostics, not to pass
patient probes. NVIDIA's strict-schema diagnostic **timed out at 7,007 ms**;
catalogue support is therefore advertised, not successfully live-validated for
that optional evaluator request. Deterministic evaluation fallback is unchanged.

## Actual live results, not scripted unit results

All smoke runs use the unchanged original 11 unseen questions. No failing wording
was patched into retrieval. The public API does not expose private fact IDs;
separate in-process runs use the actual provider and actual backend service to
inspect their own internal audit records. They are **different encounters**, not
retroactive audit records for the HTTP run.

| Run | Passes / hosted turns | Exit | Observed failures |
| --- | --- | --- | --- |
| Gemma free, private audit | 0/11; 0 hosted | 1 | 10 rate limits, 1 timeout |
| NVIDIA, first private audit | 1/11; 1 hosted | 1 | 8 timeouts, 2 model-unavailable |
| NVIDIA, requested HTTP run on port 8787 | **11/11; 11 hosted** | **0** | None in this run |
| NVIDIA, private-audit repeat | 3/11; 3 hosted | 1 | 8 timeouts |

The passing HTTP command was:

```powershell
backend/.venv/Scripts/python.exe backend/semantic_dialogue_smoke.py --live --base-url http://127.0.0.1:8787 --output "$env:LOCALAPPDATA/MedSim/hosted-dialogue/http-nvidia-unseen.json"
```

HTTP response latencies: minimum **2,176.51 ms**, median **2,446.32 ms**, mean
**2,434.91 ms**, maximum **2,759.49 ms**. These measure text delivery, not audible
playback or medical correctness. Keyword matches are smoke-test heuristics.

The later private audit accepted `history:pnd`, `history:family`, and the pediatric
combination `history:inhaler` / `history:draft-current-medication`, each with
`valid-semantic-answer`. The other eight turns timed out, selected no facts and
returned existing safe fallback text. The first NVIDIA audit accepted only
`history:pnd`. The successful isolated NVIDIA compatibility request selected
`history:rash`, `history:tick`, `history:travel`; all were allowed active-case facts.
Some replies include more than the narrowest requested source. Grounding checks
do not prove optimal semantic relevance or clinician approval.

Raw answers, exact questions, source IDs where available, timings and all failures
remain in private JSON files outside Git:

```text
%LOCALAPPDATA%/MedSim/hosted-dialogue/audited-unseen.json
%LOCALAPPDATA%/MedSim/hosted-dialogue/audited-nvidia-unseen.json
%LOCALAPPDATA%/MedSim/hosted-dialogue/http-nvidia-unseen.json
%LOCALAPPDATA%/MedSim/hosted-dialogue/audited-nvidia-repeat.json
```

Raw patient-answer reports were not placed in frontend delivery paths, source
bundles, tracked documentation or a new public audit endpoint. No credentials,
headers, account identifiers or environment-file contents were printed.

## Runtime and preservation

The backend was restarted with the existing environment-first pattern:

```powershell
backend/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0, 'backend'); from medsim_backend.config import load_env_local; load_env_local(); import server, uvicorn; uvicorn.run(server.app, host='127.0.0.1', port=8787)"
```

Only verified task-owned backend processes were stopped, including temporary
private-audit instances. No llama-server process was running. The unrelated
listener on port 8080 was not stopped. The existing Vite instance remains at
`http://127.0.0.1:5173/`; backend health is `http://127.0.0.1:8787/health`.
Kokoro remains enabled and was ready with initialization count 1 after startup.
No local setup file was removed or changed, and no large download was resumed.

No changes were made to history/clinical data, frozen scoring fixtures, store,
UI, 3D scene, prompts, grounding validation, audio policy, API paths or SSE fields.
The 446 drafts remain pending review; no medical validation is claimed.

## Regression results

| Check actually completed | Result |
| --- | --- |
| Backend unittest discovery | Exit 0; **158 tests** (baseline 157) |
| `npm test` | Exit 0; **101 tests** |
| Standalone TypeScript, production build | Exit 0 each; 712 modules; existing large-chunk warning |
| `npm run verify` | Exit 0; four checks |
| Clinical validate / curation / investigations / audit | Exit 0 each; **72 assignable / 168 archived / 422 records** |
| Generated artifact verification | Exit 0; reproducible/current |
| Patient memory report `--check`, draft exports `--check` | Exit 0 each; 881 authored answers |
| Core history review check | Expected exit **2**; zero missing domains, **446 pending reviews** |
| Repository and production answer-leakage security scans | Exit 0; 0/292 hidden truth strings in production JS |
| Expanded tracked/untracked safety scan | Exit 0; 312 paths / 304 text files; no unexpected secrets or runtime artifacts (original template placeholder/background music excluded) |
| Focused ESLint / Python compilation / diff whitespace check | Exit 0 each |

Provider regression coverage now includes both new exact free pins, rejection of
their paid variants/dynamic routers, zero-price request caps, current-price
rejection, mandatory-reasoning rejection and the existing no-chain/timeout tests.
The metadata preflight was corrected to load private environment settings before
singleton initialization and no longer calls a removed compatibility export.

## Change inventory for this continuation

- Modified: `backend/local_llm.py`, `backend/.env.example`,
  `backend/openrouter_preflight.py`, `backend/tests/test_openrouter.py`,
  `scripts/test/local-ai-security.test.ts`, `docs/local-ai-architecture.md`.
- Modified privately/ignored: `backend/.env.local` (only requested provider/model,
  semantic enablement and stale fallback settings; key preserved).
- Created: `docs/development/openrouter-hosted-validation.md`.
- Deleted, moved, archived: none. No commit, push or staging.

All **39 nonoverlapping files** from the initial 41-path dirty worktree were
byte-for-byte unchanged. Final status has 46 modified/untracked paths including
prior work, with nothing staged. The private environment file remains ignored.
Final backend and frontend HTTP checks returned 200; the pinned hosted provider
and Kokoro both reported ready, with Kokoro initialization count 1. Health alone
is not used as evidence of inference success; that evidence is the live runs above.

Manual browser interactions, actual audible playback, debrief narration, a full
41-turn live suite and long-running reliability were not verified. Earlier live
failures prevent treating a single passing HTTP run as a dependable presentation
guarantee. The safe next step is browser testing with this pinned configuration
and a later repeat under the same bounds, not a hidden timeout increase.

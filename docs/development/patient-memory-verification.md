# Patient-memory implementation verification

Historical initial-implementation results follow. For the newer correction and
current verification, see [patient-correction.md](patient-correction.md).

Verified on 2026-10-15 against baseline commit
`529be63aeb0e69a3714214855e1f2a5f058c0ab0` (`main`). The initial worktree was
clean. Nothing was committed, pushed, moved, archived, or deleted.

## Final verification results

| Command | Exit code | Result |
| --- | --- | --- |
| `backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests` | 0 | 102 tests passed; baseline 79, 23 added |
| `node node_modules/typescript/bin/tsc -b` | 0 | TypeScript passed |
| `npm test` | 0 | 96 tests passed, including 3 new real conversation/SSE/audio-flow tests |
| `npm run verify` | 0 | 4 checks passed |
| `npm run build` | 0 | 712 modules; Vite completed in 29.65 s |
| `npm run clinical:validate` | 0 | 72 canonical cases passed |
| `npm run clinical:verify-curation` | 0 | 72 assignable, 168 archived; 3 per specialty |
| `npm run clinical:validate-investigations` | 0 | 72 cases, 422 case-specific records |
| `npm run clinical:verify-generated` | 0 | Committed artifacts are current and semantically reproducible |
| `npm run security:scan` | 0 | 269 tracked paths; no secret-shaped values or prohibited runtime artifacts |
| `npm run security:scan-frontend` | 0 | 0 of 134 server-only clinical truth strings found in production JavaScript |
| `node node_modules/eslint/bin/eslint.js scripts/test/patient-grounded-flow.test.ts scripts/test/local-ai-security.test.ts` | 0 | Changed TypeScript tests passed |
| `git diff --check` | 0 | Clean; Git reports LF/CRLF conversion warnings |
| `backend/.venv/Scripts/python.exe backend/patient_memory_report.py --output docs/development/patient-memory-coverage.json` | 0 | Report generated |
| Same report command with `--check` | 0 | Deterministic report is current |
| `backend/.venv/Scripts/python.exe backend/patient_memory_smoke.py --live` | 0 | Isolated account/API workflow and six real Kokoro WAV responses passed |
| Same live smoke with `--skip-audio` | 0 | Actual ambiguous hosted request failed safely in 2.886 s; remaining API workflow passed |

The requested script names `typecheck`, `clinical:curation:check`, and
`clinical:investigations:check` do not exist. Their supported equivalents above
were used, without modifying package scripts.

`python -m ruff check ...` returned exit 1 because Ruff is not installed in the
existing backend environment. Nothing was installed for that optional check.
An initial live-smoke registration used a `.invalid` fixture address rejected by
the existing email validator (exit 1); the fixture was corrected to an example
domain, leaving authentication unchanged. Intermediate new-test failures exposed
the existing greeting entry, an eyes/eye alias gap, and outdated permissive-model
test expectations; each was resolved before the final passing runs.

The production JavaScript remains `index-DpFWCXLL.js`, 1,549,034 bytes before
and after (zero increase). Vite's existing large-chunk warning remains. No
frontend production source changed. The only frontend configuration change
denies development memory-report paths to Vite's file server.

## Behavior and safety evidence

- Three frozen evaluation fixtures pass with identical deterministic score,
  criterion-weight/verdict, global-rating and safety projections. The fixture
  and server-manifest SHA-256 hashes match the baseline recorded in
  `patient-memory.md`.
- All 435 authored history values across all 72 cases remain exact projections;
  predefined spoken answers retain the original composer.
- New tests exercise smoking paraphrases, scoped negative answers, missing data,
  not-applicable values, adult male/female and pediatric-parent identity,
  domain integrity, minimal candidate prompts, foreign/unauthorized fact IDs,
  invented wording with valid IDs, invalid JSON/schema, injections, and latency.
- Real provider tests use mocked HTTP transports for 401/402/429/500/503,
  malformed responses, timeout, disabled reasoning and single-model selection.
  Unit and regression tests do not invoke hosted inference or load real models.
- SSE framing/media type/terminal order, owner validation, request-field bounds,
  attempt idempotency and response replay remain covered. Grounding/provenance
  details stay server-only; route inventory and request schemas are unchanged.
- Real frontend conversation code with mocked SSE and TTS verifies one accepted
  transcript pair, one synthesis request, one greeting, duplicate prevention,
  and replay after speech failure. Existing audio lifecycle, finish/debrief,
  authentication, SQLite migration and clinical tests pass.
- A fresh backend import reports `torchImported=False`, `kokoroImported=False`,
  and zero memory routes. Git tracks no runtime SQLite, WAV, model-weight or
  local environment artifacts. No web-search or additional model dependency was
  introduced. Existing provider IDs, temperature, token budget and deadline are
  unchanged; Pro is not chained after Mini.

## Live verification and limits

The live API smoke ran against temporary SQLite/account and audio-cache storage,
using the configured provider and existing verified Kokoro model cache. It passed
login, selecting `im-003`, greeting, predefined and typed questions, uncertainty,
protected refusal, transcript, real WAV synthesis, investigation result release,
diagnosis, prescription storage, completion and deterministic debrief fallback.
The smoke prescription is a storage fixture and makes no clinical claim.

The full audio run recorded one greeting and five accepted question/answer pairs
(11 transcript entries). Immediate text latencies were 49.53–87.63 ms. A separate
two-candidate ambiguous query made the hosted request and returned safe unknown
after `model-unavailable` in 2,885.99 ms. Successful hosted grounding is verified
with mocks only. The live evaluator also fell back deterministically. Cached
Kokoro produced six WAV responses; no models were downloaded. Explicit synthesis
emitted existing Torch deprecation and single-layer-dropout warnings.

No manual browser workflow, visual/3D inspection, audible playback, or lip-sync
observation was performed. API tests do not establish those manual results.

Offline memory derivation plus retrieval across 288 queries measured median
3.849 ms, p95 5.581 ms, maximum 7.489 ms on this machine. This does not predict
all deployed-machine or hosted-provider latency.

Coverage is conservative: 208 authored questions have no broad domain mapping
(exact/lexical matching remains available), and the report contains 2,069 absent
domain markers. These gaps need explicit author/reviewer input, not generated
medical facts. Free model paraphrases are deliberately rejected in favor of
case-derived spoken forms. Technical tests do not constitute medical validation.
Six existing authored values are also flagged as withheld by the conservative
text leak guard during typed delivery; original facts and predefined delivery
are preserved. These entries require review before changing that protection.

## File inventory

Created:

- `backend/patient_memory.py`: typed/versioned projection, retrieval, composer,
  protected-intent rules and grounded-output validation.
- `backend/patient_memory_report.py`: deterministic offline coverage CLI.
- `backend/patient_memory_smoke.py`: opt-in isolated live API smoke.
- `backend/tests/test_patient_dialogue_contract.py`: pre-change characterization.
- `backend/tests/test_patient_memory.py`: memory/retrieval and endpoint behavior.
- `scripts/test/patient-grounded-flow.test.ts`: real conversation/SSE/audio tests.
- `docs/development/patient-memory.md`: architecture, schema, behavior and limits.
- `docs/development/patient-memory-coverage.json`: generated coverage, no answers.
- `docs/development/patient-memory-authoring-template.md`: human-review worksheet.
- `docs/development/patient-memory-verification.md`: this verification record.

Modified:

- `backend/medsim_backend/services/patient_dialogue_service.py`: integrates safe
  retrieval and validation with existing ownership, SSE, replay and evidence.
- `backend/tests/test_local_ai.py`: grounded mock replaces formerly ungrounded
  free-text mock; retains the authored/dialogue/evaluation regression assertions.
- `backend/tests/test_openrouter.py`: additional bounded HTTP-failure tests.
- `scripts/test/local-ai-security.test.ts`: verifies the new prompt boundary and
  development-report denial rule.
- `vite.config.ts`: blocks development memory documents through the dev server.

Clinical sources and generated clinical artifacts, scorer/provider/TTS code,
UI/3D production code, auth, store, database schema and public API contracts were
not changed. Recommended next steps are browser regression review, explicit
human review of the coverage worksheet, and repeating the successful-grounding
live smoke when the configured hosted model becomes available.

# Case-local semantic patient dialogue

## Result

Unresolved and partially resolved typed questions can now be interpreted using **all patient-safe facts of the active case**, rather than only the three sources a lexical retriever happened to find. Deterministic exact, protected, identity and fully resolved paths remain immediate. Patient facts, review status, original 435 quick questions, canonical cases, evaluation fixtures, and scoring rules are unchanged.

This is a general interpretation path; it is not a claim that every possible clinical question or a live model's comprehension has been validated.

## Flow and boundaries

1. The server derives immutable memory from the active case and attempt-validated profile.
2. Existing protection runs first. Predefined questions, identity, exact questions and fully supported direct matches do not need a hosted call.
3. Missing candidates, ambiguous matches, or incomplete compound answers trigger interpretation by default. An absent lexical domain is no longer treated as proof that the case lacks that information.
4. `backend/patient_interpretation.py` projects only dialogue-permitted fact IDs, source question labels, patient-safe values, domains and review markers. Public profile facts are permitted. Evaluation, hidden investigation values, other cases, credentials, raw conversations and client-supplied filters are never projected.
5. The model receives the learner's question as one untrusted user message. Context contains at most four validated source IDs from the immediately preceding grounded clinical turn, bound to the same case and version. A new encounter/evaluation has no reusable context.
6. The model returns only `{"status":"answer|unknown|clarify","fact_ids":[...],"partial":false}`. It cannot supply reply text, dates, medicines, diagnoses, instructions or explanations. Unknown/clarify must have no IDs and partial=false; answer requires 1–4 distinct permitted IDs.
7. The server resolves IDs against the same memory and composes speech from the actual source values. Compound selections produce one patient turn, deduplicated by source/text. A partial answer adds a fixed uncertainty sentence; clarify uses a fixed natural request for clarification. Draft review requirements survive in internal audits.
8. Invalid schema, unauthorized IDs, timeout and provider errors fall back to the existing supported answer or uncertainty. A known part of a compound answer is retained when the hosted provider fails. There is no second-model chain.

The new mode defaults to enabled without editing an existing environment file. Set `MEDSIM_SEMANTIC_DIALOGUE_ENABLED=false` to restore the legacy limited-candidate fallback. No API key or model settings were altered. The selected provider must be functional for novel unresolved questions to benefit; model-unavailable means only direct/fallback dialogue remains available.

## Budgets and compatibility

- At most 64 safe sources and 30,000 serialized context characters; exceeding either fails closed without silently dropping facts.
- At most four selected facts and 1,200 composed reply characters, within the existing 2,000-character TTS request bound.
- Interpretation asks for 200 output tokens, temperature 0, no reasoning. Provider cap is 256 tokens for the server-owned interpretation task; legacy patient generation keeps its 100-token cap.
- Entire hosted wait, including the shared inference gate, is bounded to 3.2 seconds. OpenRouter retains its own at-most-three-second request timeout and pinned-model/no-paid-fallback restrictions.
- Public SSE fields and provenance enums are unchanged. Internal audits distinguish interpreted, clarification and unknown outcomes. Semantic selection is not assigned a calibrated confidence probability.
- Model-selected IDs are support metadata and do not award authored history scoring actions. Scoring fixtures are unchanged. Replay remains idempotent; transcript, audio and attempt ownership paths are preserved.
- Unknown/clarification clears old context. No original fact or clinician approval state is changed.

The Vite dev server also denies the draft JSON, draft review/baseline exports, observed-dialogue traces and interpretation reports, in addition to its existing backend/server-manifest restrictions. The production client imports none of these clinical sources.

## Verification

| Check | Result |
|---|---|
| `python -m unittest discover -s backend/tests -v` | Exit 0; 148 tests pass, including frozen scoring fixtures |
| `npm test` | Exit 0; 98 tests pass |
| `npm run build` | Exit 0; TypeScript and production build; existing large-bundle warning |
| `npm run verify` | Exit 0; four repository/clinical checks |
| `npm run security:scan` | Exit 0 |
| `npm run security:scan-frontend` | Exit 0; 0 of 292 truth strings in production JS |
| Existing history coverage and review export `--check` commands | Exit 0; 881 authored answers, 0 missing core domains, 446 reviews still pending |
| `node node_modules/eslint/bin/eslint.js vite.config.ts` | Exit 0 |
| Python compilation of changed backend modules | Exit 0 |
| `git diff --check` | Exit 0 |
| Actual Vite HTTP checks | Landing page 200; raw draft source, baseline export, observed traces and @fs draft source all 403 |

New tests validate full case-local projection, exclusion of other-case/evaluation data, selected source membership, strict schema, budgets, multi-fact composition, partial/unknown/clarify, previous-source context, replay, honest fallback, release on timeout, scoring isolation and provider token limits. Their model outputs are scripted fixtures. They validate mechanics and trust boundaries, **not real model language-comprehension accuracy**.

The original observed Thomas/Sarah regression remains included. No real hosted completion or manual browser/audio session was run here. A functioning OpenRouter model is still required to validate the new semantic path live.

## Live validation on the user's running backend

After applying the package and restarting the backend:

```text
python backend/semantic_dialogue_smoke.py
python backend/semantic_dialogue_smoke.py --live --base-url http://127.0.0.1:8787
```

The first command prints the 11-question plan without network calls. The explicit live command checks provider readiness, creates fresh local encounters for four cases, exercises new phrasing, and reports response text, model/provenance, latency and expected-content matches. It exits 2 if the model is not ready, and exits 1 for mismatches or no successful hosted turn. It does not print/read API keys or alter settings. Successful unit tests must not be reported as successful live semantic comprehension.

Do not fix a live benchmark failure by adding its exact question as a special case. Inspect model selection, source scope and prompt behavior; retain the failing wording as a regression probe. Rerun the same question manually in a fresh browser encounter with audio enabled after the live text probes pass.

## Remaining limits

A model may select an irrelevant authorized fact or fail to recognize an implication. ID validation prevents new medical values and access to hidden data; it cannot mathematically prove semantic relevance. The UI may still use short authored fragments, and unavailable clinical details stay unavailable. The 446 synthetic additions remain pending physician review. No unrestricted medical advice, independent diagnosis or arbitrary clinical-data generation is added.

No commit or push was made. This package applies after the first history-drafts package and includes the intervening observed-paraphrase fix; if that fix is already installed, Codex must preserve equivalent changes and reconcile overlapping hunks rather than apply twice.

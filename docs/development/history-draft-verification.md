# Supplemental patient-history draft verification

> Current review status: the project owner subsequently reported approval of all 446 additions by الدكتور محمد الأحمد. See [the approval record](history-additions-approval.md) for attribution, missing review-date information, current counts, and verification. The pending-review statements and test counts below describe the original pre-approval package, not the current review state. Clinical content and scoring remain unchanged.

Base: `584cfc732804fdb3653ad4d42e2774d85b5761b8` on `bahaaalhaj/MedSimApp`.
These changes are local, uncommitted, and not pushed.

## Result and clinical status

- 446 proposed synthetic additions across 72 cases, in the seven core-history domains.
- Original history: 435 answers; combined server history: 881 answers.
- Missing authored core-history domains: 0. Pending physician review: 446.
- Every original and supplemental authored question retrieves its own exact source.
- Response-guard withholding: 0 authored answers (previously six original answers were withheld).
- All additions retain `requires-clinical-review`, `synthetic-authored-draft`, and a pending clinician decision. No reviewer, date, approval, or medical validation was fabricated.
- Full medication lists are explicitly scoped to patient recall. Some fictional patients cannot recall medicine names; no doses or prescribing recommendations were added. Zero coverage gaps does not mean every clinical detail is known or validated.

## Root causes

The previous conversation's local changes were not present in this workspace or on GitHub. The implementation was reconstructed from the actual base commit and its 446-gap report.

The source bank omitted entire background-history domains. Retrieval also depended on question-word overlap, so existing facts such as MI, pillow use, nocturnal gasping, and weight gain were missed by ordinary paraphrases. The response guard then withheld some already-authored prior/family history because its disease name also appeared among diagnosis options.

## Data and retrieval flow

1. `src/clinical/history-drafts.json` owns the new, explicitly fictional candidate facts and review metadata. No hidden management, rubric, laboratory results, or differential exclusions were used to fill patient history.
2. The clinical generator appends them only to the server local-AI history. They have `scoreable: false` and `predefined: false`.
3. The learner manifest, original 435 quick questions, canonical 72-case objects, investigation catalogue, evaluation records, rubric thresholds, reference verification, and frozen scoring fixtures remain unchanged.
4. Patient memory derives domains and states from the server history and retains review requirements. Explicit concepts map paraphrases to authored facts; ambiguous compound questions retain the existing bounded candidate/model path. Family queries cannot select the patient's own prior heart attack.
5. Protected requests still bypass model assistance. Optional model assistance receives at most three selected candidate facts, and must copy an authorized composed reply exactly. A fact ID cannot authorize invented wording.
6. A disease name is allowed only in the server-composed exact source response. Default untrusted response filtering still rejects those names. Hidden investigation and diagnosis requests remain protected.
7. Supplemental IDs cannot be submitted as predefined questions and never enter recorded scoring history. Internal response/transcript audits retain fact IDs and review requirements.
8. Coverage reports independently count missing data and pending clinical review. `--validate-core-history` intentionally exits **2** while any drafts await review, even with zero missing domains.

## Review deliverables

- `history-draft-clinician-review.csv`: 446 rows, with case, patient, domain, proposed answer, rationale, and blank/pending review fields.
- `history-draft-coverage.md`: complete 72-by-7 coverage/review matrix.
- `history-draft-before.json` and `history-draft-after.json`: Michael, Thomas, and a pediatric case; source IDs, response text, and retrieval status.
- `history-draft-baseline.json`: original history and evaluation records, used to assert original data and scoring invariance.
- `patient-memory-coverage.json`: generated coverage and provenance audit, including per-fact review status.

## Automated validation

| Command | Result |
|---|---|
| `python -m unittest discover -s backend/tests -v` | Exit 0; 130 tests pass, including frozen evaluation acceptance |
| `npm test` | Exit 0; 98 tests pass |
| `node node_modules/typescript/bin/tsc -b` | Exit 0 |
| `npm run build` | Exit 0; existing large-bundle warning |
| `npm run verify` | Exit 0; data, scene, citations, clinical cases |
| `npm run clinical:validate-investigations` | Exit 0; 72 cases, 422 records |
| `npm run clinical:verify-curation` | Exit 0; 72 assignable, 168 archived |
| `npm run clinical:generate` | Exit 0; all generated artifacts rebuilt successfully |
| `npm run clinical:verify-generated` | Exit 0; generated clinical artifacts current and semantically reproducible |
| `npm run security:scan` | Exit 0; repository safety scan |
| `npm run security:scan-frontend` | Exit 0; 0/292 server truth strings in production JavaScript |
| `python backend/patient_memory_report.py --output docs/development/patient-memory-coverage.json --check` | Exit 0 |
| `python backend/history_draft_report.py --check` | Exit 0 |
| `python backend/patient_memory_report.py --validate-core-history` | Exit 2 expected; zero missing domains, 446 pending clinical review |
| Targeted ESLint for changed TypeScript files | Exit 0 |
| `git diff --check` | Exit 0 |

The generator's runtime lookup now supports `CODEX_PRIMARY_RUNTIME_NODE_MODULES` in addition to its existing Windows fallback. ZIP normalization uses a fixed local calendar date, avoiding a pre-1980 DOS timestamp west of UTC. The original canonical review workbook is preserved byte-for-byte because its clinical data did not change; supplemental review is exported separately.

## Manual browser checklist (not executed here)

| Patient | Checks |
|---|---|
| Michael Williams, Internal Medicine (`im-003`) | Ask reason for visit, pharmacy event, repeat readings, medicines, tobacco/alcohol; confirm original quick-question buttons and no added draft buttons. |
| Thomas Gonzalez, Cardiology (`card-003`) | Ask about lying flat, waking gasping, weight gain, prior heart attack, and progression; expect three pillows, twice weekly, 4 kg/2 weeks, MI four years ago, progression over three months. |
| Sarah Perez, Pediatrics (`peds-002`) | Ask about medicines and drug allergies; confirm parent speech. Ask a protected diagnosis question; confirm refusal with no model call. |

For each: verify one answer per turn, text before optional audio, replay without duplicate transcript, no stale follow-up after changing patients, and normal debrief completion.

## Limits

Physician review of the 446 new facts is outstanding. The user's reported sign-off of previous cases does not automatically approve these additions. Patient replies remain bounded to authored English facts, with clarification/uncertainty for unsupported detail; this is not unrestricted clinical conversation. Browser playback, real Kokoro synthesis, and a live hosted-provider request were not exercised in this environment. Endpoint behavior and provider/audio failure paths were checked with automated tests. Existing large-bundle warnings remain.

## Changed-file inventory

- `backend/history_draft_report.py`
- `backend/local_ai.py`
- `backend/medsim_backend/services/patient_dialogue_service.py`
- `backend/patient_memory.py`
- `backend/patient_memory_report.py`
- `backend/tests/test_history_drafts.py`
- `backend/tests/test_local_ai.py`
- `backend/tests/test_patient_correction.py`
- `backend/tests/test_patient_dialogue_contract.py`
- `backend/tests/test_patient_memory.py`
- `docs/development/history-draft-after.json`
- `docs/development/history-draft-baseline.json`
- `docs/development/history-draft-before.json`
- `docs/development/history-draft-clinician-review.csv`
- `docs/development/history-draft-coverage.md`
- `docs/development/history-draft-verification.md`
- `docs/development/patient-memory-coverage.json`
- `docs/generated/clinical-artifacts.manifest.json`
- `docs/generated/local-ai-manifest.server.json`
- `scripts/clinical/export-review.ts`
- `scripts/clinical/generated-artifacts.ts`
- `scripts/test/clinical-generation.test.ts`
- `scripts/test/history-drafts.test.ts`
- `src/clinical/history-drafts.json`

# Grounded patient dialogue

Current default: [case-local semantic interpretation](patient-interpretation.md)
lets unresolved/incomplete questions consider every safe fact of the active
patient. The three-candidate-only policy below is historical and remains available
only with `MEDSIM_SEMANTIC_DIALOGUE_ENABLED=false`. Supplemental history and its
review state are described in `history-draft-verification.md`.

The initial implementation is described below. The current schema is `1.1.0`;
see [the focused correction report](patient-correction.md) for scoped missing-history
responses, compound grounding, attempt-local context and background Kokoro preparation.

Patient truth remains in the canonical clinical source and its existing generated
`docs/generated/local-ai-manifest.server.json` projection. `backend/patient_memory.py`
derives immutable memory at request time; no independent answers, embedding
model, database migration, public memory endpoint, or external retrieval is added.

The implementation baseline is commit `529be63aeb0e69a3714214855e1f2a5f058c0ab0`
on `main`, with a clean worktree, 79 passing backend tests, and five additional
pre-change dialogue characterization tests. Frozen evaluation acceptance fixtures
remain at SHA-256 `b555001b5794e749e2996e5d6c1a367109a6a27825ec2e3786cc38556e4d8629`.
The unchanged server manifest is SHA-256
`87b572f5cb37080989c7316f7bcb634da9687cf1856c8b42760d92d193a07cda`.

## Memory schema and derivation

`PatientMemory` has `schema_version` (`1.0.0`), `case_id`, `case_version`, and
immutable `facts`. Each `PatientFact` records its ID, category, explicit state,
original authored value, patient-safe value, source field and question ID,
dialogue permission, protection classification, deterministic aliases, case ID,
case version, and original question. Identity uses the attempt's already-validated
public variant profile; history is copied from the active case only.

States are `known-positive`, `known-negative`, `unknown`, `not-documented`,
`not-applicable`, and `protected`. Negative classification recognizes explicit
authored denials only. A positive count means an authored value exists, not a
clinical assertion that every symptom in that value is positive. Compound
history answers remain intact. Missing fields and unclassified question domains
are reported for human review. Protected memory entries are field markers with
no copied diagnosis, rubric, treatment, scoring, or reference values.

## Retrieval and response policy

1. Normalize question punctuation/case and a small set of lexical variants.
2. Reject protected intent before retrieval or model invocation.
3. Match exact authored questions, deterministic public-profile intents, then
   case-local lexical/domain candidates. Compound questions cannot borrow an
   absent domain from a different fact or patient.
4. An exact question has confidence 1. A unique candidate scoring at least 4,
   separated from the next by at least 2, is immediate (confidence 0.8–1).
   Scores use overlapping question words, domain aliases, and text similarity.
5. Ambiguity has confidence below 0.8 and at most three relevant candidates.
   No candidate, an absent domain, and protected requests are immediate and
   never call OpenRouter.

Aliases cover chief complaint, onset, duration, progression, location, character,
severity, frequency, aggravating/relieving factors, associated symptoms,
previous episodes, medical/surgical history, medication, allergies, family,
smoking, alcohol, substance exposure, occupation, travel, exposure, diet,
activity, sleep, sexual/menstrual/obstetric/pediatric history, concerns,
seasonality, and authored blood-pressure readings. Availability always depends
on the current case. Unmapped authored questions still support exact/lexical
matching. General questions do not imply access to unrecorded subdomains.

Predefined questions keep their existing exact authored value and legacy spoken
composition. Typed fragments reuse the existing bounded seasonal, timing,
frequency and severity composer, with explicit denial, uncertainty,
not-applicable, and literal-duration templates. Adult wording is gender-neutral;
pediatric templates use the existing under-14 parent strategy. No greeting is
added to a response.

OpenRouter receives only the current untrusted question and candidate question
labels with case-derived spoken replies. Prior dialogue, the full history,
rubrics, diagnoses, investigation manifests and unrelated cases are excluded.
The existing provider, Mini/optional Pro configuration, 80-token limit,
temperature 0.1, reasoning disabled, single-model request and absolute patient
deadline remain unchanged.

The provider returns JSON with one supplied `fact_id` and its spoken `text`.
Validation checks schema, ID membership, case/version, permission and length,
then requires the exact case-derived spoken form. A valid ID cannot authorize
new symptoms, numerical values or plausible embellishment. This deliberately
restricts model assistance to selecting grounded wording; arbitrary paraphrases
are rejected because their clinical equivalence cannot be established safely.
The existing diagnosis/answer-key text guard also runs before acceptance.
Invalid output and provider errors fall back to honest uncertainty. No second
model is called, and no new web/tool integration exists.

## Provenance, scoring, transcript and audio compatibility

Internal categories are `predefined-authored`, `deterministic-fact`,
`deterministic-authored`, `openrouter-grounded`, `safe-unknown`, and
`protected-refusal`. The bounded response replay cache and server transcript
record IDs, original values, case/version, memory version, confidence,
returned model ID, latency, validation and fallback reason. They retain the
existing owner/expiry and in-memory lifetime. No durable attempt storage is
introduced; browser transcript and authenticated debrief-history storage retain
their existing behavior.

Public SSE retains `data: {...}\n\n`, ordered text chunks, one terminal `done`,
the same fields and existing provenance values (`deterministic-authored`,
`openrouter`, `safe-unknown`). Detailed memory/provenance is never serialized
there. Repeating a request ID replays the same text without another transcript
pair. The initial greeting remains one existing entry. A model-selected history
ID is internal support metadata and cannot award an authored scoring action.
Deterministic matches continue to capture authored evidence.

No frontend production source or TTS implementation changes. Accepted text uses
the existing SSE parser, transcript commit, ordered synthesis queue and replay
path. Public `openrouter` provenance preserves the existing non-cacheable-model
speech policy. Text does not wait for Kokoro readiness. Evaluation arithmetic,
criteria, clinical values, case assignment, auth, SQL migrations and routes are
unchanged. Passing technical checks does not establish clinical validity.

## Development coverage and performance

Generate or check the report without providers or models:

```powershell
backend/.venv/Scripts/python.exe backend/patient_memory_report.py --output docs/development/patient-memory-coverage.json
backend/.venv/Scripts/python.exe backend/patient_memory_report.py --output docs/development/patient-memory-coverage.json --check
```

The report covers 72 cases and 435 authored questions. It records 599 documented
values (including 288 public profile values), 123 explicit denials, one
not-applicable value, zero explicitly unknown answers, 2,069 missing domain
markers, and 432 protected field markers. These counts are conservative mapping
metadata, not new clinical facts. Vite denies these development files; the
production build imports none of them. The authoring worksheet in this directory
requires human review of gaps without filling them automatically.

The report separately flags six authored values withheld from typed delivery by
the existing text leak guard (four family-history and two unclassified entries).
Their authored values and predefined responses remain unchanged. The guard is
conservative about diagnosis terminology and text normalization. Review these
explicit source mappings before considering any relaxation of that guard;
memory domain availability alone does not override delivery protection.

An offline 288-query benchmark across all 72 cases measured memory derivation
plus retrieval at median 3.849 ms, p95 5.581 ms, maximum 7.489 ms on this machine.
These are local measurements, not a production latency guarantee. Route tests
also check immediate paths against a 300 ms budget; hosted/TTS latency is separate.

The opt-in `backend/patient_memory_smoke.py --live` uses configured OpenRouter
and an already-verified Kokoro cache with temporary account/audio storage. It
does not print credentials or patient answers. Impose an outer 180-second process
deadline when running it. It verifies API behavior, not visual or audible browser
behavior. No model downloads should be performed to make a smoke test pass.

The completed live API smoke used isolated storage and `im-003`. Login, one
greeting, five accepted turns, six Kokoro WAV responses, investigation release,
diagnosis, prescription storage, completion and debrief returned successful
statuses. Immediate text responses took 49.53–87.63 ms in the full audio run.
A supplemental, explicitly tied two-candidate query exercised the hosted path:
OpenRouter was unavailable and safe uncertainty returned in 2,885.99 ms. No
successful live grounded completion is claimed. Mocked tests validate successful
grounding and invalid output. The live evaluator also used deterministic fallback.
No browser navigation, visual/3D inspection, lip-sync observation, or audible
playback was manually performed. Existing Torch/Kokoro emitted deprecation and
single-layer dropout warnings during the explicit live synthesis only.

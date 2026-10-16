# Conversation readiness: 72-case technical audit

Checked 2026-10-16 on the current uncommitted working tree. This is bounded
technical conversation coverage, **not** medical validation, approval of the
446 clinical drafts, exhaustive natural-language validation, or a promise that
a free hosted provider will never fail.

Machine-readable, answer-free results: [conversation-readiness.json](conversation-readiness.json).

## Corrections

- Routine, unqualified opening/status questions select the active patient's
  existing presenting concern. A shared grammar covers adult/parent wording,
  greetings, and time qualifiers across all 72 cases. No case-specific answer or
  exact benchmark-question exception was added. Qualified questions such as
  feeling different after exercise, medicines, or surgery keep their own path;
  protected requests are checked first.
- Patient-known blood pressure is distinct from clinician-visible vitals. An
  unqualified BP question with no authored patient BP history returns scoped
  uncertainty without an inference request. Existing authored BP readings remain
  accessible. No screen measurement was copied into patient knowledge.
- Exact authored onset questions take priority over prior follow-up context.
  The audit found this defect in `im-005` and `neuro-003`; answers now use the
  correct existing source, not the preceding topic. This corrects source/evidence
  selection without changing the authored timeline, scoring rules or weights.
- Short semantic qualifiers retain the topic from their own selected source:
  for example, mild headache and low-grade fever are spoken with their topics.
  Only explicit source topics/adjectives are combined. Unknowns and denials are
  not turned into symptoms. Parent wording is retained. Predefined responses and
  the existing legacy compositor are unchanged; the model still selects IDs,
  never the final words.

## All-case matrix

The offline audit exercises the actual FastAPI routes with external networking
blocked, a scripted provider, temporary standalone accounts storage, and TTS
preload disabled. It does not consume OpenRouter quota or load a second Kokoro.

| Coverage | Count |
|---|---:|
| Cases | 72 |
| Exact authored typed-history turns | 881 |
| Original predefined replies preserved | 435 |
| Draft predefined submissions rejected | 446 |
| Opening/status turns | 432 |
| Protected-question turns | 432 |
| BP knowledge-boundary turns | 72 |
| Failure/retry/replay checks | 216 |
| Total checks, including creation/projection/evidence assertions | 3,490 |
| Failed checks / failed cases | 0 / 0 |
| Actual hosted completion requests | 0 |

The first, pre-correction run had 433 failed criteria in 3,489 checks: 360 routine
opening checks and 71 unavailable-BP checks depended on the scripted unavailable
provider, plus the two authored-onset selection defects. Those counts are audit
criteria, not 433 observed clinical errors. The final matrix adds a known-BP
reading check and passes 3,490 checks. The 144 final scripted provider calls are
the deliberate failure and clarification-retry fixtures, not hosted requests.

The full server-case semantic checksum before and after the final audit is:

```text
cc5c770f1f99a0cbe88c5076d9615dcf5c8ca39229c3ebaa6c9e5151cc8a6a7e
```

All original history, clinical values, case versions, rubrics, evaluation rules,
references and review metadata remain unchanged. Curation remains 72 assignable /
168 archived; investigations remain 422; all 446 drafts still require review.

## Verification

| Command/check | Actual result |
|---|---|
| Python unittest discovery | 180 tests pass; exit 0, including frozen scoring |
| `npm test` | 104 tests pass; exit 0 |
| TypeScript validation | Exit 0 |
| `npm run verify` | All four checks pass; exit 0 |
| Production build | Exit 0; existing >500 kB chunk warning |
| Clinical validation, references, audit, curation, investigations | Exit 0 |
| `npm run clinical:verify-generated` | Exit 0; outputs current and reproducible |
| Memory/history report checks | Exit 0 |
| Core-history review gate | Expected exit 2; zero missing domains, 446 pending reviews |
| Repository/production answer-leakage security scans | Exit 0; 0/292 prohibited truth strings in production JS |
| `git diff --check` | Exit 0 |

Existing dependency deprecation and Git LF/CRLF conversion notices may appear.
No dependency versions were changed.

After the approved backend restart, actual local HTTP checks for Sarah White
returned her existing presenting concern in 39.46 ms and scoped BP uncertainty in
28.02 ms. Both completed with `actualModel: null`; same-ID replay was identical.
The existing Kokoro persistent-cache path returned HTTP 200 and valid 3.05-second
WAV audio (`af_bella`) in 87.17 ms. These were zero-hosted-completion checks, not
an all-case live hosted-model evaluation or an assertion of browser playback.

## Reproduce

```powershell
backend/.venv/Scripts/python.exe backend/conversation_audit.py
backend/.venv/Scripts/python.exe backend/conversation_audit.py --output docs/development/conversation-readiness.json
backend/.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
```

The report command regenerates only this development audit JSON. It never
rewrites clinical data. Reports contain IDs, counts and checksums, not patient
answers or hidden evaluation truth.

## Change scope and remaining checks

Created: `backend/conversation_audit.py`,
`backend/tests/test_conversation_readiness.py`, and these two readiness reports.
Modified: `backend/patient_memory.py`, `backend/patient_interpretation.py`,
`backend/medsim_backend/services/patient_dialogue_service.py`, and the semantic
presentation expectation in `backend/tests/test_patient_interpretation.py`.
No files were removed, moved or archived. Unrelated pre-existing work was retained.

No clinical inputs/generated clinical artifacts, store, frontend UI, API shapes,
provider selection, paid blocking, routing, timeouts, audio implementation,
evaluation arithmetic or local-model setup were intentionally changed. The
previous startup-order and TLS-context fixes remain intact. Hosted evaluator
compatibility remains **unverified**, with deterministic fallback preserved.

Manual browser playback, screenshots, Finish-to-debrief after these changes, and
arbitrary new free-text questions remain unverified. The existing automated
client tests cover transcript/audio exactly-once and cancellation. Novel or
ambiguous questions can still require OpenRouter; outages must remain retryable
system errors rather than fabricated patient uncertainty. Missing patient facts
must remain unavailable rather than being invented to hide a coverage gap.

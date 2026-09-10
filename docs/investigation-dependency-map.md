# Investigation dependency map

This map records the investigation data flow before the 72-case rebuild. It is the boundary for the migration: the canonical clinical case remains the single authoring model, while the server owns per-attempt orders and immutable result snapshots.

## Authoring and build-time flow

```text
curation workbook / clinical references
  -> src/clinical/curation.ts (72-case allowlist and versions)
  -> src/clinical/cases.ts + src/clinical/investigations.ts (canonical case model)
  -> scripts/clinical/validate-investigations.ts (clinical/data invariants)
  -> docs/generated/investigation-manifest.server.json (server-only answer key)
  -> backend/server.py (validated manifest loader)
```

The safe case catalogue may expose investigation identifiers, names, categories, roles, availability, and turnaround information. It must not expose patient-specific results or interpretation answers before an order becomes available.

## Encounter runtime flow

```text
accepted curated case
  -> POST /api/attempts
  -> server assigns case id + case version to opaque attempt id
  -> learner UI receives the safe investigation catalogue
  -> POST /api/attempts/{attemptId}/investigations/orders
  -> server validates attempt, case version, investigation id, and availability
  -> server stores an immutable order/result snapshot under an opaque order id
  -> GET /api/attempts/{attemptId}/investigations/{orderId}
  -> UI renders ordered / pending / available / unavailable states
```

The client must not derive a result from `caseId`, `testId`, diagnosis, abnormality flags, or a generic normal-results table. Direct lookup by predictable case/test identifiers is not a result API.

## Grading and export flow

```text
server-owned attempt order snapshots
  -> debrief request investigation evidence (same ids, values, units, reports)
  -> deterministic investigation scorer
     - selection
     - interpretation
     - stewardship
     - safety
  -> learner debrief

canonical investigation definitions + reference registry
  -> review workbook investigation worksheets
  -> reviewer sign-off / unresolved queue
```

## Existing consumers to migrate

| Area | Existing dependency | Required destination |
|---|---|---|
| Domain types | `Test`, string-only `PatientCase.testResults` | Structured canonical `CaseInvestigation` and attempt order snapshots |
| Catalogue | `src/data/tests.ts` and broad panels | Case-specific investigation catalogue; no one-click broad workups |
| Store | `orderedTestIds` immediately added to `completedTestIds` | Async server attempt/order/result state |
| Ordering UI | All master tests grouped into three coarse categories | Searchable case catalogue with clinical categories and explicit states |
| Results UI | `getTestReport()` plus abnormal flag | Structured numeric, panel, score, and report renderers |
| Imaging | `getImagingExamples()` generic diagnosis/test image selection | Case-owned verified image asset or explicit unavailable placeholder |
| Debrief | Recomputed local case results | Exact immutable server order snapshots |
| Export | All master tests plus generic image lookup | Eight investigation-focused review sections sourced from canonical records |
| Validation | Non-empty string/availability checks | Schema, units, leakage, linkage, safety, scoreability, and 72-case coverage checks |

## Legacy paths to deactivate

- Generic normal-result generation in `src/data/defaultTestResults.ts`.
- Diagnosis-keyed generic radiology selection in `src/data/radiologyImages.ts` for curated encounters.
- Instant local completion in `orderPolyclinicTest`.
- Broad panel shortcuts that order unrelated tests without individual learner choices.
- Any frontend import of the server result manifest.

## Security invariants

1. Attempt ids and order ids are opaque and non-sequential.
2. Every order/result request is checked against the attempt owner, assigned case, and case version.
3. Only ordered results are returned; pending and unavailable states do not include hidden result fields.
4. The stored result snapshot is deep-copied at order time and is never recomputed from mutable client state.
5. Duplicate orders are idempotent and cannot create a new result variant.
6. Unknown case and investigation ids fail closed.
7. Unresolved clinical content is `verificationStatus: "unresolved"` and `scoreable: false`.

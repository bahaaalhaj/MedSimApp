# Clinical case governance

MedSim is a formative educational prototype, not clinical decision-support or a high-stakes examination. The legacy catalogue contains synthetic cases and technical consistency checks; neither establishes medical accuracy. The canonical pilot bank therefore uses explicit lifecycle states and defaults to showing only `approved-formative` cases.

## Scope

- Intended learners: undergraduate students in clinical years; recent graduates may use cases only as formative practice.
- Pilot clinical region: United Kingdom guidance, because the three existing authored rubrics cite NICE. This is configurable per case and is not assumed applicable in Iraq or another jurisdiction.
- Content language: English.
- Guidance priority: applicable local/national guidance, then relevant official professional guidance. Conflicts are recorded for a qualified reviewer; software does not resolve them clinically.
- Cases use synthetic composites and must not contain identifiable patient data.

## Lifecycle

`legacy-unreviewed → draft → technical-review → clinical-review → approved-formative`

`revision-required` can be entered from review. `retired` prevents new assignment while retaining versioned history. Automated checks may support movement to `technical-review`; only a qualified clinician or faculty reviewer, identified in the review record, may assign `approved-formative`. Approval requires a completed checklist, an approval statement, no unresolved critical comment, and a future review date. Source verification is not clinical approval.

At 2026-09-10 the exact bank status is:

- `clinical-review`: 3 (`im-003`, `im-004`, `im-005`)
- `approved-formative`: 0
- legacy records: all other preserved catalogue IDs, marked `legacy-unreviewed`

No clinician review identity or approval has been supplied. Curated mode is consequently empty. Development mode explicitly labels pending and legacy cases.

## Responsibilities and controls

- Authors provide measurable objectives, complete truth, five same-level options, modeled results, medication expectations, safety content, rubric criteria, and reference mappings.
- Technical reviewers run schema, integrity, leakage, reproducibility, migration, reference, test, and build checks.
- Clinical reviewers verify every clinical field against the cited source and local practice. Reviewer identity and conflicts must be recorded with permission.
- Educational reviewers assess learner level, option quality, observability, and fairness; this does not replace clinical review.
- Approved versions are immutable. Material clinical changes create a new semantic version. Superseded guidance flags dependent cases for re-review.
- AI may match recorded evidence and write feedback. It cannot change the diagnosis, rubric weights, maximum scores, critical logic, or reference allowlist. Scores are recomputed deterministically from rubric weights.

Educational design should be reviewed against the NBME Item-Writing Guide and, where applicable, the INACSL Healthcare Simulation Standards of Best Practice, relevant AMEE virtual-patient/simulation guidance, and MedBiquitous Virtual Patient interoperability specifications. These frameworks inform educational design only; none validates condition-specific clinical content.

## Current limitations

The three pilots are migrated from synthetic legacy content and remain pending clinical review. Medication dose details deliberately remain `not-finalized` where the existing data is not defensible. The SPA still carries legacy clinical truth in its compiled bundle for compatibility; the new backend safe-summary endpoint does not leak truth, but complete server-owned attempt delivery remains required before claiming strong answer-key confidentiality. Voice messages currently lack trustworthy per-message timestamps, which are represented as `null` rather than invented.

MedSim must not be used to guide care for real patients.

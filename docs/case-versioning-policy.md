# Case versioning policy

Canonical case, rubric, and reference-set versions use semantic versions. Approved versions are immutable. A change to diagnosis logic, learner-visible results, management, medication, safety content, rubric, or reference applicability creates a new case version and a change summary. Wording-only fixes that cannot alter performance may use a patch version after review.

Every encounter stores canonical ID, case version, rubric version, reference-set context, and variant seed. Historical evaluations retain the full patient snapshot and must resolve the version actually used; they must not silently display a newer truth. A retired version remains readable for history but is excluded from assignment.

Review is due at least annually and whenever a cited source is updated, withdrawn, or superseded. Source supersession forces re-review. The curated rebuild is version `1.1.0`; the three earlier `1.0.0` pilot objects are retained in `HISTORICAL_CLINICAL_CASE_VERSIONS`. No fabricated human-review date is recorded.

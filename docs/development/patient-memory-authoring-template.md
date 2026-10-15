# Patient-history additions for human review

This is an authoring worksheet, not clinical truth or approval. Do not populate
gaps automatically. Proposed facts must be explicitly reviewed and added to the
canonical clinical source through the existing curation workflow, then generated
with `npm run clinical:generate`. Do not edit the patient-memory projection or
the generated server manifest to add answers.

| Field | Reviewer entry |
| --- | --- |
| Case ID and existing case version | |
| Proposed history domain | |
| Question ID and exact learner question | |
| Exact authored patient answer | |
| State: known-positive / known-negative / unknown / not-documented / not-applicable | |
| Evidence for that state (an absent field is not a denial) | |
| Patient/parent perspective | |
| Sensitivity and permission for patient dialogue | |
| Facts that must remain protected | |
| Source and permission record | |
| Clinical reviewer and review date | |
| Existing curation status; proposed status after explicit review | |
| Required case version / migration / audit record | |
| Approved question paraphrases and expected exact meaning | |

Keep unreviewed additions out of assignment. A technically passing validator does
not establish medical validity or accreditation. The coverage report records
mapping gaps; it neither supplies clinical answers nor promotes review status.

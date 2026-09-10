# Case authoring guide

Author canonical cases in `src/clinical/cases.ts` against the contracts in `src/clinical/types.ts`. Preserve stable public IDs; add a compatibility entry for any legacy relationship. Start every new case as `draft`.

Each case needs a semantic case/rubric/reference-set version, clinical region, learner level, formative-only declaration, measurable objectives, synthetic patient profile, history and examination, vitals, complete modeled investigations, exactly five same-level diagnosis options with supporting/against findings, management, medication expectations, contraindications, red flags, referrals, safety-netting, explicit rubric, references, review record, and change summary.

Every clinical rubric criterion must be observable in the encounter evidence, link to at least one objective, and cite a source that supports the actual criterion. Do not score communication without transcript evidence. An absent event is insufficient evidence, not permission to infer it. Never use the legacy automatic rubric for an approved case.

Investigations must have a case-specific result. Requests outside the model display `UNAVAILABLE / NOT MODELED`; do not add a generic normal result. Educational reference imaging requires source, license, attribution, accessible interpretation, and honest labeling. It must not be presented as the simulated patient's image.

Medication fields include generic name, indication, dose or explicitly pending reviewed range, unit, route, frequency, duration, allergies, contraindications, organ adjustments, restrictions, monitoring, alternatives, and references. A prescription tab does not imply medication is necessary. Referral, non-drug care, or no medication may be correct.

Variants may change only allowlisted presentation fields within reviewed bounds. They are deterministic from canonical ID, version, and stored seed. Never randomize diagnosis, results, management, medicine, safety, or scoring truth.

Run `npm run clinical:validate`, `npm run clinical:references`, `npm run clinical:audit`, `npm run verify`, `npm test`, and `npm run build` before review.
# Curated-bank requirements

Every learner case must belong to `CURATED_CASE_IDS`, use version `1.1.0` or later, contain exactly five differential diagnoses with one best answer, declare investigation availability, carry a 5–8 criterion rubric totaling 100, and include explicit critical-failure logic. Exact medication choices remain non-scoreable without current BNF and local-formulary verification.

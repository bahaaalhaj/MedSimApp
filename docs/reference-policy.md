# Clinical reference policy

Use current official clinical-practice guidelines first, followed by national authorities, international or national professional societies, regulators, and systematic reviews when no suitable guideline exists. Educational-design references guide simulation construction only and never validate clinical content.

Open the official source page; verify title, year/update, jurisdiction, exact section or recommendation, URL, access date, and supersession. Record unknown fields as empty or unavailable. Never invent DOI, PMID, page, quotation, or recommendation identifiers. Avoid long copied passages; use reviewable paraphrases with the source link. Mark failed or ambiguous verification `unverified` and retain the weaker or inaccessible-source issue for review.

`source-verified` means the official metadata and link were checked. `clinician-verified` requires a documented human review. A superseded source flags all dependent cases for a new case version or documented exception. Conflicting guidance is recorded, scoped by jurisdiction and population, and referred to the clinical reviewer.

The pilot uses NICE because the existing authored rubrics were UK-scoped. Medication and referral rules must be reconciled before use in another jurisdiction. Run `npm run clinical:references` to rebuild the thesis exports.

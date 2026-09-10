import type { ClinicalReference } from './types';

// Source metadata was checked against the linked official NICE pages on
// 2026-09-10. "source-verified" records provenance only; it is not a clinical
// endorsement of any MedSim case or rubric.
export const CLINICAL_REFERENCES: ClinicalReference[] = [
  {
    referenceId: 'nice-ng136', organization: 'National Institute for Health and Care Excellence',
    title: 'Hypertension in adults: diagnosis and management', publicationYear: 2019,
    version: 'NG136; last updated 26 February 2026', region: 'United Kingdom',
    sourceType: 'clinical-practice-guideline', url: 'https://www.nice.org.uk/guidance/ng136',
    section: 'Recommendations 1.2, 1.3, 1.4 and 1.5', accessedAt: '2026-09-10',
    verificationStatus: 'source-verified', notes: 'Applicability outside the UK requires clinician review.',
  },
  {
    referenceId: 'nice-ng28', organization: 'National Institute for Health and Care Excellence',
    title: 'Type 2 diabetes in adults: management', publicationYear: 2015,
    version: 'NG28; last updated 18 February 2026', region: 'United Kingdom',
    sourceType: 'clinical-practice-guideline', url: 'https://www.nice.org.uk/guidance/ng28',
    section: 'Structured education, dietary advice, HbA1c targets and initial medicines', accessedAt: '2026-09-10',
    verificationStatus: 'source-verified', notes: '2026 medicines update requires clinical reconciliation with the legacy rubric.',
  },
  {
    referenceId: 'nice-ng250', organization: 'National Institute for Health and Care Excellence',
    title: 'Pneumonia: diagnosis and management', publicationYear: 2025,
    version: 'NG250; minor update January 2026', region: 'United Kingdom',
    sourceType: 'clinical-practice-guideline', url: 'https://www.nice.org.uk/guidance/ng250',
    section: 'Recommendations 1.2, 1.5, 1.6, 1.10, 1.11 and 1.12', accessedAt: '2026-09-10',
    verificationStatus: 'source-verified', notes: 'Dose choice and local antimicrobial policy still require clinician review.',
  },
  {
    referenceId: 'nbme-item-writing-2021', organization: 'National Board of Medical Examiners',
    title: 'NBME Item-Writing Guide', publicationYear: 2021, region: 'International educational use',
    sourceType: 'official-curriculum', url: 'https://www.nbme.org/institutions/nbme-item-writing-guide/',
    section: 'One-best-answer items and option-writing guidance', accessedAt: '2026-09-10',
    verificationStatus: 'source-verified', notes: 'Educational design reference; does not validate clinical content.',
  },
];

export const CLINICAL_REFERENCE_BY_ID = new Map(CLINICAL_REFERENCES.map((r) => [r.referenceId, r]));

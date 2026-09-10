import type { ClinicalReference } from './types';
import { PRIMARY_REFERENCE_BY_CASE_ID } from './curation.ts';

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
  ...buildCurationReferences(),
];

export const CLINICAL_REFERENCE_BY_ID = new Map(CLINICAL_REFERENCES.map((r) => [r.referenceId, r]));

function buildCurationReferences(): ClinicalReference[] {
  const special: Record<string, [string, string, string]> = {
    'AAO-BPPV': ['AAO-HNSF', 'Clinical Practice Guideline: BPPV (Update)', 'https://www.entnet.org/quality-practice/quality-products/clinical-practice-guidelines/bppv/'],
    'ASCRS-FISSURE': ['American Society of Colon and Rectal Surgeons', 'Anal fissure clinical practice guideline', 'https://fascrs.org/ascrs/media/files/2023-Anal-Fissures-CPG.pdf'],
    'ASH-ITP': ['American Society of Hematology', 'ASH guideline for immune thrombocytopenia', 'https://ashpublications.org/bloodadvances/article/3/23/3829/428877'],
    'BASK-MENISCUS': ['British Association for Surgery of the Knee', 'Meniscal surgery guideline', 'https://baskonline.com/professional/clinical-guidelines'],
    'BESS-SHOULDER': ['British Elbow and Shoulder Society', 'Frozen shoulder patient care pathway', 'https://bess.ac.uk/standards-guidelines/'],
    'BSACI-RHINITIS': ['BSACI', 'Rhinitis guideline', 'https://www.bsaci.org/guidelines/bsaci-guidelines/rhinitis/'],
    'BSG-IDA': ['British Society of Gastroenterology', 'Iron deficiency anaemia guideline', 'https://gut.bmj.com/content/70/11/2030'],
    'BTS-NODULE': ['British Thoracic Society', 'Pulmonary nodules guideline', 'https://www.brit-thoracic.org.uk/quality-improvement/guidelines/pulmonary-nodules/'],
    'BTS-PLEURAL': ['British Thoracic Society', 'Pleural disease guideline', 'https://www.brit-thoracic.org.uk/quality-improvement/guidelines/pleural-disease/'],
    'EAACI-URTICARIA': ['EAACI/GA²LEN/EuroGuiDerm/APAAACI', 'International urticaria guideline', 'https://onlinelibrary.wiley.com/doi/10.1111/all.15090'],
    'EAU-UROTRAUMA': ['European Association of Urology', 'Paediatric urology: acute scrotum and testicular torsion', 'https://uroweb.org/guidelines/paediatric-urology/chapter/the-guideline'],
    HERNIASURGE: ['HerniaSurge Group', 'International guidelines for groin hernia management', 'https://doi.org/10.1007/s10029-017-1668-x'],
    'NICE-ANKLE': ['NICE CKS', 'Sprains and strains', 'https://cks.nice.org.uk/topics/sprains-strains/'],
    'NICE-BELLS': ['NICE CKS', 'Bell’s palsy', 'https://cks.nice.org.uk/topics/bells-palsy/'],
    'NPH-GUIDELINE': ['Japanese Society of Normal Pressure Hydrocephalus', 'Idiopathic normal pressure hydrocephalus guidelines, third edition', 'https://doi.org/10.1111/cen3.12759'],
    'PCOS-2023': ['Monash University/International PCOS Network', '2023 international evidence-based PCOS guideline', 'https://www.monash.edu/medicine/mchri/pcos/guideline'],
  };
  const ids = [...new Set(Object.values(PRIMARY_REFERENCE_BY_CASE_ID))];
  return ids.map((referenceId): ClinicalReference => {
    const mapped = special[referenceId];
    const niceCode = referenceId.replace(/^NICE-/, '').toLowerCase();
    const url = referenceId === 'NICE-CG160'
      ? 'https://www.nice.org.uk/guidance/ng143'
      : mapped?.[2] ?? `https://www.nice.org.uk/guidance/${niceCode}`;
    return {
      referenceId,
      organization: mapped?.[0] ?? 'National Institute for Health and Care Excellence',
      title: mapped?.[1] ?? `NICE guidance ${referenceId.replace('NICE-', '')}`,
      publicationYear: referenceId === 'PCOS-2023' ? 2023 : 2026,
      version: 'Live publisher version at access date; recommendation-level reconciliation remains required',
      region: referenceId.startsWith('NICE-') || referenceId.startsWith('B') ? 'United Kingdom' : 'International',
      sourceType: 'clinical-practice-guideline',
      url,
      accessedAt: '2026-09-10',
      verificationStatus: 'source-verified',
      notes: 'Publisher target and applicability were source-checked for formative provenance. This is not clinician approval; exact prescribing details remain non-scoreable pending BNF and local-formulary review.',
    };
  });
}

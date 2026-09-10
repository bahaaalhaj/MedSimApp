import type { ClinicId } from '../game/clinic.ts';
import { POLYCLINIC_CASES } from '../data/polyclinicPatients.ts';

/**
 * Release contract transcribed from MedSim_72_Case_Curation_and_Rebuild_Plan.xlsx.
 * The workbook is evidence-planning input, not proof of clinical approval.
 */
export const CURATED_CASE_IDS_BY_SPECIALTY = {
  'allergy-immunology': ['allergy-001', 'allergy-004', 'allergy-006'],
  cardiology: ['card-001', 'card-002', 'card-003'],
  'cardiothoracic-vascular-surgery': ['ctv-002', 'ctv-003', 'ctv-009'],
  dermatology: ['derm-001', 'derm-003', 'derm-008'],
  endocrinology: ['endo-001', 'endo-002', 'endo-004'],
  ent: ['ent-003', 'ent-004', 'ent-010'],
  gastroenterology: ['gi-003', 'gi-004', 'gi-005'],
  'general-surgery': ['gs-001', 'gs-004', 'gs-007'],
  hematology: ['heme-001', 'heme-002', 'heme-003'],
  'infectious-disease': ['id-001', 'id-004', 'id-010'],
  'internal-medicine': ['im-003', 'im-004', 'im-005'],
  nephrology: ['neph-001', 'neph-002', 'neph-008'],
  neurology: ['neuro-001', 'neuro-003', 'neuro-005'],
  neurosurgery: ['nsg-002', 'nsg-004', 'nsg-006'],
  obgyn: ['obgyn-002', 'obgyn-003', 'obgyn-006'],
  oncology: ['onc-001', 'onc-007', 'onc-008'],
  ophthalmology: ['oph-001', 'oph-002', 'oph-003'],
  orthopedics: ['ortho-001', 'ortho-004', 'ortho-008'],
  pediatrics: ['peds-001', 'peds-002', 'peds-005'],
  pmr: ['pmr-001', 'pmr-003', 'pmr-005'],
  psychiatry: ['psych-001', 'psych-002', 'psych-010'],
  pulmonology: ['pulm-001', 'pulm-002', 'pulm-003'],
  rheumatology: ['rheum-001', 'rheum-003', 'rheum-005'],
  urology: ['uro-001', 'uro-003', 'uro-006'],
} as const satisfies Record<Exclude<ClinicId, 'all-specialties'>, readonly [string, string, string]>;

export const CURATED_CASE_IDS = Object.freeze(
  Object.values(CURATED_CASE_IDS_BY_SPECIALTY).flat(),
) as readonly string[];

const curatedSet = new Set(CURATED_CASE_IDS);
const allLegacyIds = Object.entries(POLYCLINIC_CASES)
  .filter(([specialty]) => specialty !== 'all-specialties')
  .flatMap(([, cases]) => cases.map((clinicalCase) => clinicalCase.id));

export const EXCLUDED_LEGACY_CASE_IDS = Object.freeze(
  [...new Set(allLegacyIds)].filter((caseId) => !curatedSet.has(caseId)),
) as readonly string[];

export const PRIMARY_REFERENCE_BY_CASE_ID: Readonly<Record<string, string>> = {
  'allergy-001': 'BSACI-RHINITIS', 'allergy-004': 'EAACI-URTICARIA', 'allergy-006': 'NICE-NG245',
  'card-001': 'NICE-CG126', 'card-002': 'NICE-NG196', 'card-003': 'NICE-NG106',
  'ctv-002': 'BTS-NODULE', 'ctv-003': 'BTS-PLEURAL', 'ctv-009': 'NICE-CG147',
  'derm-001': 'NICE-CG153', 'derm-003': 'NICE-NG198', 'derm-008': 'NICE-NG14',
  'endo-001': 'NICE-NG145', 'endo-002': 'NICE-NG145', 'endo-004': 'PCOS-2023',
  'ent-003': 'NICE-NG84', 'ent-004': 'AAO-BPPV', 'ent-010': 'NICE-NG98',
  'gi-003': 'NICE-CG184', 'gi-004': 'NICE-NG20', 'gi-005': 'NICE-NG129',
  'gs-001': 'HERNIASURGE', 'gs-004': 'NICE-CG188', 'gs-007': 'ASCRS-FISSURE',
  'heme-001': 'ASH-ITP', 'heme-002': 'BSG-IDA', 'heme-003': 'NICE-NG239',
  'id-001': 'NICE-NG33', 'id-004': 'NICE-NG95', 'id-010': 'NICE-NG141',
  'im-003': 'NICE-NG136', 'im-004': 'NICE-NG28', 'im-005': 'NICE-NG250',
  'neph-001': 'NICE-NG203', 'neph-002': 'NICE-NG118', 'neph-008': 'NICE-NG148',
  'neuro-001': 'NICE-CG150', 'neuro-003': 'NICE-BELLS', 'neuro-005': 'NICE-NG71',
  'nsg-002': 'NICE-NG59', 'nsg-004': 'NICE-NG59', 'nsg-006': 'NPH-GUIDELINE',
  'obgyn-002': 'NICE-NG126', 'obgyn-003': 'NICE-NG88', 'obgyn-006': 'NICE-NG73',
  'onc-001': 'NICE-NG122', 'onc-007': 'NICE-NG101', 'onc-008': 'NICE-NG151',
  'oph-001': 'NICE-NG81', 'oph-002': 'NICE-NG77', 'oph-003': 'NICE-NG242',
  'ortho-001': 'BESS-SHOULDER', 'ortho-004': 'BASK-MENISCUS', 'ortho-008': 'NICE-ANKLE',
  'peds-001': 'NICE-NG91', 'peds-002': 'NICE-NG245', 'peds-005': 'NICE-CG160',
  'pmr-001': 'NICE-NG236', 'pmr-003': 'NICE-NG59', 'pmr-005': 'NICE-CG146',
  'psych-001': 'NICE-NG222', 'psych-002': 'NICE-CG113', 'psych-010': 'NICE-CG115',
  'pulm-001': 'NICE-NG245', 'pulm-002': 'NICE-NG115', 'pulm-003': 'NICE-NG202',
  'rheum-001': 'NICE-NG100', 'rheum-003': 'NICE-NG219', 'rheum-005': 'NICE-NG65',
  'uro-001': 'NICE-CG97', 'uro-003': 'NICE-NG118', 'uro-006': 'EAU-UROTRAUMA',
};

export const TIME_CRITICAL_CASE_IDS = Object.freeze([
  'derm-008', 'endo-002', 'ent-010', 'gi-005', 'neph-002', 'neph-008',
  'neuro-003', 'obgyn-002', 'onc-001', 'onc-008', 'peds-002', 'peds-005',
  'rheum-003', 'uro-003', 'uro-006',
]) as readonly string[];

export function isCuratedCaseId(caseId: string): boolean {
  return curatedSet.has(caseId);
}

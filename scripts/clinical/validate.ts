import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { CLINICAL_CASES, CLINICAL_CASE_BY_ID } from '../../src/clinical/cases.ts';
import { CLINICAL_REFERENCE_BY_ID } from '../../src/clinical/references.ts';
import { CASE_REVIEW_STATUSES } from '../../src/clinical/types.ts';
import { generateControlledVariant } from '../../src/clinical/variants.ts';
import { LEGACY_CASE_MIGRATIONS } from '../../src/clinical/migration.ts';
import { POLYCLINIC_CASES } from '../../src/data/polyclinicPatients.ts';
import { MEDICATIONS } from '../../src/data/medications.ts';
import { CURATED_CASE_IDS, CURATED_CASE_IDS_BY_SPECIALTY, EXCLUDED_LEGACY_CASE_IDS } from '../../src/clinical/curation.ts';

export interface ClinicalViolation { case: string; rule: string; detail: string }

const SEMVER = /^\d+\.\d+\.\d+$/;

export function validateClinicalCases(): ClinicalViolation[] {
  const out: ClinicalViolation[] = [];
  const seen = new Set<string>();
  const medicationIds = new Set(MEDICATIONS.map((m) => m.id));
  const objectiveRefs = (id: string, criterion: string[], valid: Set<string>) => {
    for (const objective of criterion) if (!valid.has(objective)) out.push({ case: id, rule: 'rubric objective missing', detail: objective });
  };

  for (const c of CLINICAL_CASES) {
    if (seen.has(c.caseId)) out.push({ case: c.caseId, rule: 'duplicate canonical case ID', detail: c.caseId });
    seen.add(c.caseId);
    if (!SEMVER.test(c.caseVersion) || !SEMVER.test(c.rubricVersion)) out.push({ case: c.caseId, rule: 'invalid version', detail: `${c.caseVersion}/${c.rubricVersion}` });
    if (!(CASE_REVIEW_STATUSES as readonly string[]).includes(c.reviewStatus)) out.push({ case: c.caseId, rule: 'invalid review status', detail: c.reviewStatus });
    if (c.differentialDiagnoses.length !== 5) out.push({ case: c.caseId, rule: 'diagnosis options', detail: `expected 5, got ${c.differentialDiagnoses.length}` });
    if (c.caseVersion !== '1.1.0') out.push({ case: c.caseId, rule: 'curated version', detail: `expected 1.1.0, got ${c.caseVersion}` });
    if (c.reviewStatus !== 'source-verified-formative' || c.approvalBasis !== 'source-only') out.push({ case: c.caseId, rule: 'honest lifecycle', detail: `${c.reviewStatus}/${c.approvalBasis}` });
    if (!c.curationRequirements?.requiredClinicalCorrection || !c.curationRequirements.safetyEscalationRequirement) out.push({ case: c.caseId, rule: 'workbook rebuild requirement missing', detail: 'clinical correction and escalation are required' });
    const correct = c.differentialDiagnoses.filter((d) => d.isCorrect && d.diagnosisId === c.correctDiagnosis.diagnosisId);
    if (correct.length !== 1) out.push({ case: c.caseId, rule: 'correct diagnosis cardinality', detail: String(correct.length) });
    if (new Set(c.differentialDiagnoses.map((d) => d.diagnosisId)).size !== 5) out.push({ case: c.caseId, rule: 'duplicate diagnosis option', detail: 'options must be unique' });
    const objectives = new Set(c.learningObjectives.map((o) => o.objectiveId));
    const criteria = new Set(c.assessmentRubric.criteria.map((r) => r.criterionId));
    const rubricWeight = c.assessmentRubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (c.assessmentRubric.criteria.length < 5 || c.assessmentRubric.criteria.length > 8 || rubricWeight !== 100) out.push({ case: c.caseId, rule: 'rubric shape', detail: `${c.assessmentRubric.criteria.length} criteria / ${rubricWeight} points` });
    if (criteria.size !== c.assessmentRubric.criteria.length) out.push({ case: c.caseId, rule: 'duplicate rubric criterion', detail: 'criterionId must be unique' });
    for (const r of c.assessmentRubric.criteria) {
      if (r.learningObjectiveIds.length === 0) out.push({ case: c.caseId, rule: 'rubric criterion lacks objective', detail: r.criterionId });
      objectiveRefs(c.caseId, r.learningObjectiveIds, objectives);
      if (r.domain !== 'communication' && r.referenceIds.length === 0) out.push({ case: c.caseId, rule: 'clinical criterion lacks reference', detail: r.criterionId });
      for (const ref of r.referenceIds) if (!CLINICAL_REFERENCE_BY_ID.has(ref)) out.push({ case: c.caseId, rule: 'rubric reference missing', detail: `${r.criterionId}:${ref}` });
    }
    for (const ref of c.references) {
      const resolved = CLINICAL_REFERENCE_BY_ID.get(ref);
      if (!resolved) out.push({ case: c.caseId, rule: 'case reference missing', detail: ref });
      if (resolved?.verificationStatus === 'superseded') out.push({ case: c.caseId, rule: 'superseded reference', detail: ref });
    }
    for (const investigation of c.investigations) {
      if (['available-if-ordered', 'result-available'].includes(investigation.availability) && !investigation.result.trim()) out.push({ case: c.caseId, rule: 'orderable investigation result missing', detail: investigation.testId });
      if (!investigation.availability) out.push({ case: c.caseId, rule: 'investigation availability missing', detail: investigation.testId });
    }
    for (const medication of c.medicationExpectations) {
      const required = ['medicationId', 'genericName', 'indication', 'dose', 'unit', 'route', 'frequency', 'duration'] as const;
      for (const key of required) if (!medication[key].trim()) out.push({ case: c.caseId, rule: 'medication core field missing', detail: `${medication.medicationId}:${key}` });
      if (!medicationIds.has(medication.medicationId)) out.push({ case: c.caseId, rule: 'medication ID missing from catalogue', detail: medication.medicationId });
    }
    if (c.reviewStatus === 'approved-formative') {
      if (c.reviewRecord.clinicalReviewers.length === 0 || !c.reviewRecord.approvalStatement) out.push({ case: c.caseId, rule: 'approved case lacks human evidence', detail: 'clinical reviewer and approval statement required' });
      if (c.reviewRecord.unresolvedComments.some((x) => x.critical && !x.resolvedAt)) out.push({ case: c.caseId, rule: 'approved case has unresolved critical comment', detail: 'approval forbidden' });
      if (Object.values(c.reviewRecord.checklist).some((x) => x !== 'accepted' && x !== 'not-applicable')) out.push({ case: c.caseId, rule: 'approved checklist incomplete', detail: 'all review decisions must be closed' });
    }
    if (c.presentingComplaint.publicSummary.toLowerCase().includes(c.correctDiagnosis.label.toLowerCase())) out.push({ case: c.caseId, rule: 'public summary leaks diagnosis', detail: c.correctDiagnosis.label });
    if (c.variantPolicy) {
      const a = generateControlledVariant(c.caseId, 'validator-seed');
      const b = generateControlledVariant(c.caseId, 'validator-seed');
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ case: c.caseId, rule: 'variant not reproducible', detail: 'same seed differs' });
      if (a && (a.age < c.variantPolicy.ageRange.min || a.age > c.variantPolicy.ageRange.max)) out.push({ case: c.caseId, rule: 'variant outside bounds', detail: String(a.age) });
    }
  }

  const legacyIds = new Set<string>();
  for (const [clinic, cases] of Object.entries(POLYCLINIC_CASES)) if (clinic !== 'all-specialties') for (const c of cases) legacyIds.add(c.id);
  const mapped = new Set(LEGACY_CASE_MIGRATIONS.map((m) => m.legacyCaseId));
  for (const id of legacyIds) if (!mapped.has(id)) out.push({ case: id, rule: 'historical case unresolved', detail: 'missing migration record' });
  for (const c of CLINICAL_CASES) if (!legacyIds.has(c.caseId)) out.push({ case: c.caseId, rule: 'canonical compatibility missing', detail: 'pilot ID must resolve to legacy history' });
  if (CURATED_CASE_IDS.length !== 72 || new Set(CURATED_CASE_IDS).size !== 72) out.push({ case: 'curation', rule: 'curated count', detail: String(CURATED_CASE_IDS.length) });
  if (EXCLUDED_LEGACY_CASE_IDS.length !== 168 || new Set(EXCLUDED_LEGACY_CASE_IDS).size !== 168) out.push({ case: 'curation', rule: 'excluded count', detail: String(EXCLUDED_LEGACY_CASE_IDS.length) });
  for (const [specialty, idsForSpecialty] of Object.entries(CURATED_CASE_IDS_BY_SPECIALTY)) {
    if (idsForSpecialty.length !== 3) out.push({ case: specialty, rule: 'specialty curation count', detail: String(idsForSpecialty.length) });
    for (const id of idsForSpecialty) if (CLINICAL_CASE_BY_ID.get(id)?.specialtyId !== specialty) out.push({ case: id, rule: 'specialty mapping', detail: specialty });
  }
  return out;
}

export function runClinicalValidation(): number {
  const violations = validateClinicalCases();
  if (violations.length === 0) { console.log(`PASS  clinical validation (${CLINICAL_CASES.length} canonical cases)`); return 0; }
  for (const v of violations) console.error(`FAIL  [${v.case}] ${v.rule}: ${v.detail}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(runClinicalValidation());

import { CLINICAL_CASES } from '../../src/clinical/cases.ts';
import { INVESTIGATION_CATEGORIES } from '../../src/clinical/types.ts';
import { TESTS } from '../../src/data/tests.ts';
import { CURATED_CASE_IDS_BY_SPECIALTY, TIME_CRITICAL_CASE_IDS } from '../../src/clinical/curation.ts';

const errors: string[] = [];
const categories = new Set<string>(INVESTIGATION_CATEGORIES);
const masterIds = new Set(TESTS.map((item) => item.id));
const urgentIds = new Set<string>(TIME_CRITICAL_CASE_IDS);
const forbiddenResultKeys = new Set(['result', 'structuredResult', 'postSubmissionExplanation', 'supportsDiagnosisIds', 'arguesAgainstDiagnosisIds']);

for (const clinicalCase of CLINICAL_CASES) {
  if (clinicalCase.investigations.length === 0) errors.push(`${clinicalCase.caseId}: no modeled investigations`);
  const ids = new Set<string>();
  const roles = new Set(clinicalCase.investigations.map((item) => item.role));
  for (const requiredRole of ['essential', 'conditional', 'optional', 'not-indicated']) if (!roles.has(requiredRole as never)) errors.push(`${clinicalCase.caseId}: missing ${requiredRole} investigation classification`);
  if (urgentIds.has(clinicalCase.caseId) && !clinicalCase.investigations.some((item) => item.role === 'potentially-harmful' && item.prerequisite)) errors.push(`${clinicalCase.caseId}: urgent case lacks explicit dangerous-delay protection`);
  for (const investigation of clinicalCase.investigations) {
    const prefix = `${clinicalCase.caseId}/${investigation.testId}`;
    if (ids.has(investigation.testId)) errors.push(`${prefix}: duplicate investigation id`);
    ids.add(investigation.testId);
    if (!masterIds.has(investigation.testId)) errors.push(`${prefix}: investigation id is absent from master catalogue`);
    if (!categories.has(investigation.category)) errors.push(`${prefix}: invalid category`);
    if (!investigation.name.trim() || !investigation.reason.trim()) errors.push(`${prefix}: missing learner catalogue content`);
    if (investigation.availability === 'available-if-ordered' && !investigation.structuredResult) errors.push(`${prefix}: orderable investigation has no case-specific result`);
    if (investigation.role === 'essential' && !investigation.structuredResult) errors.push(`${prefix}: essential investigation has no modeled response`);
    if (investigation.role === 'conditional' && !investigation.prerequisite) errors.push(`${prefix}: conditional investigation lacks indication/prerequisite`);
    if (investigation.role === 'not-indicated' && investigation.structuredResult) errors.push(`${prefix}: not-indicated investigation fabricates a result`);
    if (investigation.verificationStatus === 'unresolved' && investigation.scoreable) errors.push(`${prefix}: unresolved content cannot be scoreable`);
    if (investigation.scoreable && investigation.referenceIds.length === 0) errors.push(`${prefix}: scoreable content requires a reference`);
    if (investigation.structuredResult?.kind === 'numeric' && !investigation.structuredResult.unit.trim()) errors.push(`${prefix}: numeric result lacks unit`);
    if (investigation.structuredResult?.kind === 'panel') {
      for (const component of investigation.structuredResult.components) {
        if (typeof component.value === 'number' && !component.unit) errors.push(`${prefix}/${component.analyteId}: numeric panel component lacks unit`);
      }
    }
    if (investigation.structuredResult?.kind === 'image' && !investigation.structuredResult.report.trim()) errors.push(`${prefix}: imaging result lacks report`);
    if (investigation.result && investigation.result.toLowerCase().includes(clinicalCase.correctDiagnosis.label.toLowerCase())) errors.push(`${prefix}: learner result contains the correct diagnosis label`);
  }
  const safe = clinicalCase.investigations.map(({ testId, name, category, role, availability, reason, turnaroundSec, prerequisite }) => ({ testId, name, category, role, availability, reason, turnaroundSec, prerequisite }));
  for (const row of safe) for (const key of Object.keys(row)) if (forbiddenResultKeys.has(key)) errors.push(`${clinicalCase.caseId}: safe catalogue leaks ${key}`);
}

for (const [specialty, ids] of Object.entries(CURATED_CASE_IDS_BY_SPECIALTY)) {
  if (ids.length !== 3) errors.push(`${specialty}: expected exactly 3 curated case ids`);
  const complete = CLINICAL_CASES.filter((clinicalCase) => clinicalCase.specialtyId === specialty && clinicalCase.investigations.length > 0).length;
  if (complete !== 3) errors.push(`${specialty}: expected 3 complete investigation models, received ${complete}`);
}

if (CLINICAL_CASES.length !== 72) errors.push(`expected 72 curated cases, received ${CLINICAL_CASES.length}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Investigation validation passed for ${CLINICAL_CASES.length} cases and ${CLINICAL_CASES.reduce((n, c) => n + c.investigations.length, 0)} case-specific records.`);

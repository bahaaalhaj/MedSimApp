import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { CLINICAL_CASES, CLINICAL_CASE_BY_ID, isAssignableCase } from '../../src/clinical/cases.ts';
import { CURATED_CASE_IDS, CURATED_CASE_IDS_BY_SPECIALTY, EXCLUDED_LEGACY_CASE_IDS } from '../../src/clinical/curation.ts';
import { validateClinicalCases } from './validate.ts';

export function verifyCuration(): string[] {
  const failures = validateClinicalCases().map((item) => `${item.case}: ${item.rule} (${item.detail})`);
  if (CURATED_CASE_IDS.length !== 72) failures.push(`curated manifest has ${CURATED_CASE_IDS.length}, expected 72`);
  if (EXCLUDED_LEGACY_CASE_IDS.length !== 168) failures.push(`excluded manifest has ${EXCLUDED_LEGACY_CASE_IDS.length}, expected 168`);
  if (CLINICAL_CASES.length !== 72) failures.push(`canonical catalogue has ${CLINICAL_CASES.length}, expected 72`);
  for (const [specialty, ids] of Object.entries(CURATED_CASE_IDS_BY_SPECIALTY)) if (ids.length !== 3) failures.push(`${specialty} has ${ids.length} curated cases`);
  for (const id of EXCLUDED_LEGACY_CASE_IDS) {
    if (isAssignableCase(id, 'curated')) failures.push(`${id} is assignable`);
    if (CLINICAL_CASE_BY_ID.has(id)) failures.push(`${id} resolves through learner catalogue`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = verifyCuration();
  if (failures.length) { failures.forEach((failure) => console.error(`FAIL  ${failure}`)); process.exit(1); }
  console.log('PASS  curation contract (72 assignable, 168 archived, 3 per specialty)');
}

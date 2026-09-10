import assert from 'node:assert/strict';
import test from 'node:test';
import { CLINICAL_CASES, CLINICAL_CASE_BY_ID, isAssignableCase, toSafeCaseSummary, toSafeEncounterCase } from '../../src/clinical/cases.ts';
import { CURATED_CASE_IDS_BY_SPECIALTY, EXCLUDED_LEGACY_CASE_IDS } from '../../src/clinical/curation.ts';
import { generateControlledVariant } from '../../src/clinical/variants.ts';
import { validateClinicalCases } from '../clinical/validate.ts';
import { getTestReport } from '../../src/data/defaultTestResults.ts';
import { readFileSync } from 'node:fs';

test('curated 72-case bank passes deterministic validation', () => {
  assert.deepEqual(validateClinicalCases(), []);
  assert.equal(CLINICAL_CASES.length, 72);
  assert.equal(EXCLUDED_LEGACY_CASE_IDS.length, 168);
  for (const ids of Object.values(CURATED_CASE_IDS_BY_SPECIALTY)) assert.equal(ids.length, 3);
});

test('source-backed cases are formative-assignable without claiming clinician approval', () => {
  for (const c of CLINICAL_CASES) {
    assert.equal(c.reviewStatus, 'source-verified-formative');
    assert.equal(c.approvalBasis, 'source-only');
    assert.equal(isAssignableCase(c.caseId, 'curated'), true);
    assert.equal(isAssignableCase(c.caseId, 'development'), true);
    assert.equal(c.assessmentRubric.criteria.reduce((sum, item) => sum + item.weight, 0), 100);
  }
  for (const id of EXCLUDED_LEGACY_CASE_IDS) {
    assert.equal(isAssignableCase(id, 'curated'), false);
    assert.equal(isAssignableCase(id, 'development'), false);
    assert.equal(CLINICAL_CASE_BY_ID.has(id), false);
  }
});

test('time-critical sentinel cases contain deterministic escalation gates', () => {
  const torsion = CLINICAL_CASE_BY_ID.get('uro-006')!;
  const ectopic = CLINICAL_CASE_BY_ID.get('obgyn-002')!;
  const suddenHearingLoss = CLINICAL_CASE_BY_ID.get('ent-010')!;
  assert.match(torsion.safetyNetting[0].instruction, /Immediate surgical\/urology|Time-critical/i);
  assert.match(ectopic.safetyNetting[0].instruction, /emergency|time-critical/i);
  assert.match(suddenHearingLoss.safetyNetting[0].instruction, /24 hours|Immediate/i);
  for (const item of [torsion, ectopic, suddenHearingLoss]) {
    assert.equal(item.criticalFailureRules[0].consequence, 'fail');
    assert.equal(item.medicationScoring.enabled, false);
  }
});

test('safe DTOs do not serialize ground truth or rubrics', () => {
  const c = CLINICAL_CASES[0];
  for (const dto of [toSafeCaseSummary(c), toSafeEncounterCase(c)]) {
    const json = JSON.stringify(dto);
    assert.equal(json.includes('correctDiagnosis'), false);
    assert.equal(json.includes('assessmentRubric'), false);
    assert.equal(json.includes('medicationExpectations'), false);
    assert.equal(json.includes('rationale'), false);
    assert.equal(json.includes('result'), false);
  }
});

test('controlled variants are deterministic and remain inside declared bounds', () => {
  for (const c of CLINICAL_CASES) {
    const a = generateControlledVariant(c.caseId, 'same-seed');
    const b = generateControlledVariant(c.caseId, 'same-seed');
    assert.deepEqual(a, b);
    assert.ok(a);
    assert.ok(a.age >= c.variantPolicy!.ageRange.min && a.age <= c.variantPolicy!.ageRange.max);
    assert.ok(c.variantPolicy!.allowedDisplayNames.includes(a.displayName));
  }
});

test('unmodeled investigation is explicit and never defaults to normal', () => {
  const report = getTestReport('unmodeled-test', undefined, false);
  assert.match(report.text, /UNAVAILABLE \/ NOT MODELED/);
  assert.doesNotMatch(report.text, /No significant findings/);
});

test('patient cards and doorway brief do not render the diagnosis field', () => {
  const library = readFileSync('src/components/CaseLibraryScreen.tsx', 'utf8');
  const brief = readFileSync('src/components/BriefScreen.tsx', 'utf8');
  const gp = readFileSync('src/components/GPRoomScreen.tsx', 'utf8');
  assert.doesNotMatch(library, /\{c\.cond\}/);
  assert.doesNotMatch(brief, /\{c\.cond\}/);
  assert.doesNotMatch(gp, /\{next\.cond\}/);
});

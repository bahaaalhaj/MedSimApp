import assert from 'node:assert/strict';
import test from 'node:test';
import { CLINICAL_CASES, isAssignableCase, toSafeCaseSummary, toSafeEncounterCase } from '../../src/clinical/cases.ts';
import { generateControlledVariant } from '../../src/clinical/variants.ts';
import { validateClinicalCases } from '../clinical/validate.ts';
import { getTestReport } from '../../src/data/defaultTestResults.ts';
import { readFileSync } from 'node:fs';

test('canonical pilot bank passes deterministic validation', () => {
  assert.deepEqual(validateClinicalCases(), []);
  assert.equal(CLINICAL_CASES.length, 3);
});

test('curated mode excludes every pilot until genuine approval exists', () => {
  for (const c of CLINICAL_CASES) {
    assert.equal(c.reviewStatus, 'clinical-review');
    assert.equal(isAssignableCase(c.caseId, 'curated'), false);
    assert.equal(isAssignableCase(c.caseId, 'development'), true);
  }
});

test('safe DTOs do not serialize ground truth or rubrics', () => {
  const c = CLINICAL_CASES[0];
  for (const dto of [toSafeCaseSummary(c), toSafeEncounterCase(c)]) {
    const json = JSON.stringify(dto);
    assert.equal(json.includes('correctDiagnosis'), false);
    assert.equal(json.includes('assessmentRubric'), false);
    assert.equal(json.includes('medicationExpectations'), false);
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

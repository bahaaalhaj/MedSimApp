import assert from 'node:assert/strict';
import test from 'node:test';
import { CLINICAL_CASES, toSafeEncounterCase } from '../../src/clinical/cases.ts';
import { evaluateInvestigations } from '../../src/clinical/investigationEvaluation.ts';

test('all curated investigations have structured case-specific records and safe catalogues do not leak results', () => {
  assert.equal(CLINICAL_CASES.length, 72);
  for (const clinicalCase of CLINICAL_CASES) {
    assert.ok(clinicalCase.investigations.length > 0, clinicalCase.caseId);
    for (const investigation of clinicalCase.investigations) {
      if (investigation.availability === 'available-if-ordered' || investigation.role === 'essential') assert.ok(investigation.structuredResult, `${clinicalCase.caseId}/${investigation.testId}`);
      if (investigation.verificationStatus === 'unresolved') assert.equal(investigation.scoreable, false);
    }
    const safe = toSafeEncounterCase(clinicalCase);
    for (const item of safe.investigations) {
      assert.equal('result' in item, false);
      assert.equal('structuredResult' in item, false);
      assert.equal('postSubmissionExplanation' in item, false);
    }
  }
});

test('deterministic investigation scoring penalizes missed essential and harmful selection', () => {
  const base = CLINICAL_CASES.flatMap((clinicalCase) => clinicalCase.investigations)[0];
  const investigations = [
    { ...base, testId: 'essential', role: 'essential' as const, verificationStatus: 'source-verified' as const, scoreable: true },
    { ...base, testId: 'useful', role: 'useful' as const, verificationStatus: 'source-verified' as const, scoreable: true },
    { ...base, testId: 'harmful', role: 'potentially-harmful' as const, verificationStatus: 'source-verified' as const, scoreable: true },
  ];
  const result = evaluateInvestigations({ investigations, orderedInvestigationIds: ['useful', 'harmful'], correctlyInterpretedIds: ['useful'] });
  assert.equal(result.selection, 33);
  assert.equal(result.interpretation, 100);
  assert.equal(result.safety, 0);
  assert.deepEqual(result.missedEssentialIds, ['essential']);
  assert.deepEqual(result.harmfulOrderIds, ['harmful']);
});

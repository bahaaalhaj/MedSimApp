import assert from 'node:assert/strict';
import test from 'node:test';
import drafts from '../../src/clinical/history-drafts.json' with { type: 'json' };
import { buildLearnerCaseSemanticPayload, buildLocalAiSemanticPayload } from '../clinical/generated-artifacts.ts';

test('all 446 approved supplemental facts remain server-only and non-scoreable', () => {
  const learner = buildLearnerCaseSemanticPayload();
  const server = buildLocalAiSemanticPayload();
  assert.equal(drafts.additions.length, 446);
  assert.equal(new Set(drafts.additions.map((r) => `${r.caseId}:${r.id}`)).size, 446);
  assert.equal(learner.cases.reduce((n, c) => n + c.historyQuestions.length, 0), 435);
  assert.equal(server.cases.reduce((n, c) => n + c.patient.history.length, 0), 881);
  assert.equal(JSON.stringify(learner).includes('requires-clinical-review'), false);
  for (const row of drafts.additions) {
    assert.equal(row.clinicianDecision, 'approved');
    assert.equal(row.reviewStatus, 'clinician-approved');
    assert.equal(row.reviewerName, 'الدكتور محمد الأحمد');
    assert.equal(row.reviewerId, null);
    assert.equal(row.reviewedAt, null);
    const source = server.cases.find((c) => c.caseId === row.caseId)!.patient.history.find((h) => h.id === row.id)!;
    assert.equal(source.answer, row.answer);
    assert.equal('scoreable' in source && source.scoreable, false);
    assert.equal('predefined' in source && source.predefined, false);
    assert.equal('reviewerName' in source && source.reviewerName, row.reviewerName);
    assert.equal('reviewedAt' in source && source.reviewedAt, null);
    assert.equal('clinicianDecision' in source && source.clinicianDecision, 'approved');
  }
  assert.equal(JSON.stringify(learner).includes('الدكتور محمد الأحمد'), false);
});

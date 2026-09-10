import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEvaluation } from '../../src/agents/deterministicEvaluation.ts';

test('evaluation discards unknown criteria, fills omissions, and calculates critical failure', () => {
  const request = {
    case_id: 'test-case', critical_criterion_ids: ['safe'],
    rubric: {
      data_gathering: [{ criterion_id: 'history', label: 'History', weight: 40, evidence: 'Ask' }],
      clinical_management: [{ criterion_id: 'safe', label: 'Safety', weight: 40, evidence: 'Escalate' }],
      interpersonal: [{ criterion_id: 'communication', label: 'Communication', weight: 20, evidence: 'Explain' }],
      global_rating: 'borderline-regression',
    },
  } as any;
  const normalized = normalizeEvaluation({
    case_id: 'wrong', global_rating: 'excellent',
    domain_scores: {
      data_gathering: { raw: 999, max: 999, verdict: 'excellent' },
      clinical_management: { raw: 999, max: 999, verdict: 'excellent' },
      interpersonal: { raw: 999, max: 999, verdict: 'excellent' },
    },
    criteria: [
      { criterion_id: 'history', domain: 'data_gathering', verdict: 'met', evidence: 'Observed' },
      { criterion_id: 'unknown', domain: 'clinical_management', verdict: 'met', evidence: 'Ignore' },
    ],
    safety_breach: null, highlights: [], improvements: [], narrative: 'Model narrative',
  }, request);
  assert.deepEqual(normalized.criteria.map((criterion) => criterion.criterion_id), ['history', 'safe', 'communication']);
  assert.equal(normalized.domain_scores.data_gathering.raw, 40);
  assert.equal(normalized.domain_scores.clinical_management.raw, 0);
  assert.equal(normalized.global_rating, 'clear-fail');
  assert.match(normalized.safety_breach?.what ?? '', /mandatory patient-safety/i);
});

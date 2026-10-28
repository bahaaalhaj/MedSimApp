import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { caseEvaluationInput } from '../../src/agents/evaluationSchema.ts';
import { calculateTrainingStats, sessionPercentage } from '../../src/profile/trainingStats.ts';

const require = createRequire(import.meta.url);
const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/components/debrief/EvaluationDetails.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false,
}).outputFiles[0].text;
const module = { exports: {} as { EvaluationDetails: (props: unknown) => Parameters<typeof renderToStaticMarkup>[0] } };
runInNewContext(bundle, { module, exports: module.exports, require });
function evaluation(historical = false) {
  return caseEvaluationInput.parse({ case_id: 'fixture', global_rating: 'satisfactory',
    domain_scores: { data_gathering: { raw: 20, max: historical ? 65 : 50, verdict: 'borderline' },
      clinical_management: { raw: 22.5, max: 35, verdict: 'satisfactory' }, interpersonal: { raw: 0, max: 0, verdict: 'clear-fail' } },
    criteria: historical ? [{ criterion_id: 'fixture-r3', title: 'Historical examination', weight: 15,
      domain: 'data_gathering', verdict: 'met', evidence: 'Recorded examination actions: general-observation, focused-examination.' }] : [],
    ...(historical ? {} : { assessment_scope: { policy: 'examination-excluded-v1', excluded_criteria: [{
      criterion_id: 'fixture-r3', title: 'Focused examination', domain: 'data_gathering', original_weight: 15,
      reason: 'Examination actions are unavailable.',
    }] } }),
    highlights: [], improvements: [], narrative: 'Synthetic presentation fixture.',
    generation: { mode: 'deterministic-fallback', provider: 'scripted', error_category: null,
      configured_model: null, actual_model: null, request_id: 'fixture' } });
}
function render(value: ReturnType<typeof evaluation>) {
  return renderToStaticMarkup(module.exports.EvaluationDetails({ evaluation: value,
    patient: { orderedTestIds: [], givenTreatmentIds: [], askedQuestionIds: [], examinationActions: [] },
    c: {}, resolveCitation: () => undefined }));
}
test('new debrief preserves scope metadata and distinguishes raw /85 from normalized percentage', () => {
  const value = evaluation(); const html = render(value);
  assert.equal(value.assessment_scope?.excluded_criteria[0].original_weight, 15);
  assert.match(html, /Raw points: 42\.5\/85/);
  assert.match(html, /Normalized percentage: 50\.0%/);
  assert.match(html, /Examination — Not assessed/);
  assert.match(html, /examination-excluded-v1/);
  assert.doesNotMatch(html, /Historical examination/);
});
test('historical debrief retains /100 and its original examination verdict/evidence', () => {
  const value = evaluation(true); const html = render(value);
  assert.equal(value.assessment_scope, undefined);
  assert.match(html, /Raw points: 42\.5\/100/);
  assert.match(html, /Normalized percentage: 42\.5%/);
  assert.match(html, /Historical examination/);
  assert.match(html, /focused-examination/);
  assert.doesNotMatch(html, /Not assessed/);
});
test('profile statistics normalize each historical/new denominator without rewriting raw scores', () => {
  const current = { savedAt: 1, caseId: 'new', evaluation: evaluation() };
  const historical = { savedAt: 2, caseId: 'old', evaluation: evaluation(true) };
  historical.evaluation.domain_scores.data_gathering.raw = 27.5;
  assert.equal(sessionPercentage(current), .5); assert.equal(sessionPercentage(historical), .5);
  assert.equal(calculateTrainingStats([current, historical]).averageScorePercent, 50);
  assert.equal(current.evaluation.domain_scores.data_gathering.max, 50);
  assert.equal(historical.evaluation.domain_scores.data_gathering.max, 65);
});

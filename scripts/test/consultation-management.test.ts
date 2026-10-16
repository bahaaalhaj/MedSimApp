import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { caseEvaluationInput, consultationManagementAssessment } from '../../src/agents/evaluationSchema.ts';

const report = {
  version: '1.0.0', mode: 'formative-observation', affects_clinical_score: false, time_policy: 'context-only', overall: 'partial-evidence',
  indicators: ['focused-questioning', 'repetition-review', 'priority-sequencing', 'plan-and-safety'].map((id) => ({
    id, status: 'not-assessable', evidence: 'Insufficient recorded evidence.', counts: {}, evidence_refs: [],
  })), limitations: ['Local formative observation, not a validated medical rubric.'],
};

test('management assessment has four bounded indicators and no time or clinical score override', () => {
  assert.equal(consultationManagementAssessment.safeParse(report).success, true);
  for (const invalid of [{ ...report, affects_clinical_score: true }, { ...report, time_policy: 'faster-is-better' },
    { ...report, score: 100 }, { ...report, indicators: [] }, { ...report, overall: 'excellent' }]) {
    assert.equal(consultationManagementAssessment.safeParse(invalid).success, false);
  }
});

test('old evaluations remain valid and new assessment survives JSON persistence and Zod parsing', () => {
  const domain = { raw: 0, max: 0, verdict: 'clear-fail' };
  const evaluation = { case_id: 'fixture', global_rating: 'clear-fail',
    domain_scores: { data_gathering: domain, clinical_management: domain, interpersonal: domain }, criteria: [],
    highlights: [], improvements: [], narrative: 'Recorded feedback.', generation: { mode: 'deterministic-fallback',
      error_category: null, provider: 'deterministic', configured_model: null, actual_model: null, request_id: 'fixture' } };
  assert.equal(caseEvaluationInput.safeParse(evaluation).success, true);
  const restored = caseEvaluationInput.parse(JSON.parse(JSON.stringify({ ...evaluation, consultation_management: report })));
  assert.deepEqual(restored.consultation_management, report);
  assert.equal(restored.global_rating, evaluation.global_rating);
});

test('actual presentation renders all indicators and escapes evidence; old reviews render no fabricated panel', () => {
  const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/components/debrief/ConsultationManagement.tsx')],
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text;
  const module = { exports: {} as { ConsultationManagement: (props: { assessment?: unknown }) => Parameters<typeof renderToStaticMarkup>[0] } };
  runInNewContext(bundle, { module, exports: module.exports, require: createRequire(import.meta.url) });
  assert.equal(renderToStaticMarkup(module.exports.ConsultationManagement({})), '');
  const assessment = JSON.parse(JSON.stringify(report));
  assessment.indicators[0].evidence = '<script>not executable</script>';
  const html = renderToStaticMarkup(module.exports.ConsultationManagement({ assessment }));
  for (const label of ['Consultation management', 'Focused questioning', 'Repetition review', 'Priority sequencing', 'Plan and safety', 'Not assessable']) {
    assert.ok(html.includes(label));
  }
  assert.match(html, /clinical marks unchanged/i);
  assert.match(html, /context only/i);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the report has one presentation boundary and no frontend grading or provider calls', () => {
  const component = readFileSync(resolve(import.meta.dirname, '../../src/components/debrief/ConsultationManagement.tsx'), 'utf8');
  const parent = readFileSync(resolve(import.meta.dirname, '../../src/components/debrief/EvaluationDetails.tsx'), 'utf8');
  assert.equal((parent.match(/<ConsultationManagement\s/g) ?? []).length, 1);
  assert.doesNotMatch(component, /fetch\(|Date\.now\(|localStorage|normalize_evaluation|useGameState/);
});

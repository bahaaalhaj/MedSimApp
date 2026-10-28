import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import type { requestDebrief } from '../../src/agents/debriefClient.ts';
import type { DebriefRequest } from '../../src/agents/debriefRequest.ts';

const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/agents/debriefClient.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'import.meta.env': '{"DEV":false}' },
}).outputFiles[0].text;
const result = { case_id: 'fixture', global_rating: 'satisfactory',
  domain_scores: Object.fromEntries(['data_gathering', 'clinical_management', 'interpersonal'].map((key) => [key, { raw: 0, max: 0, verdict: 'satisfactory' }])),
  criteria: [], highlights: [], improvements: [], narrative: 'Scripted contract fixture, no clinical assessment.',
  generation: { mode: 'deterministic-fallback', error_category: 'evaluation-timeout', provider: 'scripted',
    configured_model: null, actual_model: null, request_id: 'fixture-result' } };
const request: DebriefRequest = { investigation_attempt_id: 'owner-bound-fixture', case_id: 'fixture', case_version: '1', variant_seed: 'seed',
  encounter_log: { examinations_performed: [], prescriptions: [], submitted_diagnosis_id: null, safety_netting_checks: null } };
function client(fetcher: typeof fetch) {
  const module = { exports: {} as { requestDebrief: typeof requestDebrief } };
  runInNewContext(bundle, { module, exports: module.exports, fetch: fetcher, crypto, AbortController, DOMException,
    setTimeout: (fn: () => void) => { queueMicrotask(fn); return 1; }, clearTimeout: () => undefined });
  return module.exports.requestDebrief;
}

test('completed and pending evaluations are retrieved without another POST', async () => {
  let gets = 0;
  const evaluate = client(async (url, init) => {
    assert.match(String(url), /\/recovery$/);
    assert.equal(init?.method, undefined);
    gets++;
    return Response.json(gets === 1 ? { evaluationActive: true, evaluationResult: null } : { evaluationActive: false, evaluationResult: result });
  });
  const value = await evaluate(request, new AbortController().signal);
  assert.equal(value.generation.error_category, 'evaluation-timeout', 'fallback remains visible');
  assert.equal(gets, 2);
});

test('invalid cached evaluation fails honestly and never substitutes a frontend score', async () => {
  const evaluate = client(async () => Response.json({ evaluationActive: false, evaluationResult: { invalid: true } }));
  await assert.rejects(evaluate(request, new AbortController().signal), /invalid evaluation contract/);
});

test('cancellation reaches evidence synchronization and a later retry preserves server contract', async () => {
  const controller = new AbortController();
  let interrupted = true;
  let posts = 0;
  const evaluate = client(async (url, init) => {
    if (String(url).endsWith('/recovery')) return Response.json({ evaluationActive: false, evaluationResult: null });
    assert.ok(init?.signal);
    if (String(url).endsWith('/examinations') && interrupted) {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }
    if (url === '/api/local-ai/evaluate') { posts++; return Response.json(result); }
    return Response.json({});
  });
  const withEvidence = { ...request, encounter_log: { ...request.encounter_log, examinations_performed: [{ action_id: 'general-observation', performed_at: 1000 }] } };
  await assert.rejects(evaluate(withEvidence, controller.signal), /Aborted/);
  assert.equal(posts, 0);
  interrupted = false;
  const value = await evaluate(withEvidence, new AbortController().signal);
  assert.equal(value.case_id, 'fixture');
  assert.equal(posts, 1);
});

test('evaluation HTTP errors carry the server request ID and allow a manual retry', async () => {
  const evaluate = client(async (url) => String(url).endsWith('/recovery')
    ? Response.json({ evaluationActive: false, evaluationResult: null })
    : Response.json({ detail: 'Scripted failure' }, { status: 500, headers: { 'X-MedSim-Request-Id': 'support-fixture-id' } }));
  await assert.rejects(evaluate(request, new AbortController().signal), /Scripted failure.*support-fixture-id.*retry/);
});

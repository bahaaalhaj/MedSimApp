import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import type { requestDebrief } from '../../src/agents/debriefClient.ts';
import type { DebriefRequest } from '../../src/agents/debriefRequest.ts';
import type * as investigationApi from '../../src/clinical/investigationApi.ts';
import type * as attemptOperations from '../../src/clinical/attemptQueue.ts';

const bundle = buildSync({ stdin: { contents: `export * from './src/agents/debriefClient.ts';
  export * from './src/clinical/investigationApi.ts'; export * from './src/clinical/attemptQueue.ts';`,
  resolveDir: resolve(import.meta.dirname, '../..'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'import.meta.env': '{"DEV":false}' },
}).outputFiles[0].text;
const result = { case_id: 'fixture', global_rating: 'satisfactory',
  domain_scores: Object.fromEntries(['data_gathering', 'clinical_management', 'interpersonal'].map((key) => [key, { raw: 0, max: 0, verdict: 'satisfactory' }])),
  criteria: [], highlights: [], improvements: [], narrative: 'Scripted contract fixture, no clinical assessment.',
  generation: { mode: 'deterministic-fallback', error_category: 'evaluation-timeout', provider: 'scripted',
    configured_model: null, actual_model: null, request_id: 'fixture-result' } };
const request: DebriefRequest = { investigation_attempt_id: 'owner-bound-fixture', case_id: 'fixture', case_version: '1', variant_seed: 'seed',
  encounter_log: { examinations_performed: [], prescriptions: [], submitted_diagnosis_id: null, safety_netting_checks: null } };
function runtime(fetcher: typeof fetch) {
  const module = { exports: {} as { requestDebrief: typeof requestDebrief } & typeof investigationApi & typeof attemptOperations };
  runInNewContext(bundle, { module, exports: module.exports, fetch: fetcher, crypto, AbortController, DOMException,
    setTimeout: (fn: () => void) => { queueMicrotask(fn); return 1; }, clearTimeout: () => undefined });
  return module.exports;
}
const client = (fetcher: typeof fetch) => runtime(fetcher).requestDebrief;
const turn = () => new Promise<void>((done) => setImmediate(done));
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
}
const withEvidence: DebriefRequest = { ...request, encounter_log: { ...request.encounter_log,
  prescriptions: [1, 2, 3].map((id) => ({ medication_id: `record-only-${id}`, dose: 'fixture', duration: 'fixture', prescribed_at: id })),
  submitted_diagnosis_id: 'fixture-diagnosis',
  safety_netting_checks: { summary_completed: true, safety_netting_completed: true, ideas_concerns_expectations_completed: false },
} };

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

test('multiple prescriptions, diagnosis and completion are serialized through body consumption before grading', async () => {
  const paths: string[] = [];
  let locked = false;
  const evaluate = client(async (url, init) => {
    assert.equal(locked, false, `same-attempt overlap at ${url}`);
    assert.equal(init?.credentials, 'include');
    locked = true;
    paths.push(String(url).split('/').at(-1)!);
    const response = Response.json(String(url).endsWith('/recovery') ? { evaluationResult: null, evaluationActive: false }
      : url === '/api/local-ai/evaluate' ? result : {});
    const json = response.json.bind(response);
    response.json = async () => { await turn(); locked = false; return json(); };
    return response;
  });
  await evaluate(withEvidence, new AbortController().signal);
  assert.deepEqual(paths, ['recovery', 'prescriptions', 'prescriptions', 'prescriptions', 'diagnosis', 'completion', 'evaluate']);
});

test('partial preparation failure stops later evidence and grading; manual retry keeps prescription identities', async () => {
  const stored = new Map<string, unknown>();
  let fail = true;
  const paths: string[] = [];
  const evaluate = client(async (url, init) => {
    const path = String(url).split('/').at(-1)!;
    paths.push(path);
    if (path === 'recovery') return Response.json({ evaluationResult: null, evaluationActive: false });
    if (path === 'prescriptions') {
      const item = JSON.parse(String(init?.body));
      if (item.medicationId === 'record-only-2' && fail) return Response.json({ detail: 'fixture evidence rejected' }, { status: 422 });
      stored.set(JSON.stringify(item), item);
    }
    return Response.json(path === 'evaluate' ? result : {});
  });
  await assert.rejects(evaluate(withEvidence, new AbortController().signal), /fixture evidence rejected/);
  assert.deepEqual(paths, ['recovery', 'prescriptions', 'prescriptions']);
  assert.equal(stored.size, 1);
  fail = false;
  await evaluate(withEvidence, new AbortController().signal);
  assert.equal(stored.size, 3, 'same medication/dose/duration/timestamp, no duplicate replay');
  assert.equal(paths.filter((path) => path === 'evaluate').length, 1);
});

test('debrief drains earlier order/result work and background completion before recovering or grading', async () => {
  const held = gate();
  const calls: string[] = [];
  const api = runtime(async (url) => {
    calls.push(String(url).split('/').at(-1)!);
    return Response.json(String(url).endsWith('/recovery') ? { evaluationResult: null, evaluationActive: false }
      : url === '/api/local-ai/evaluate' ? result : {});
  });
  const background = api.trackAttemptWork(request.investigation_attempt_id!, async () => {
    await api.orderInvestigation(request.investigation_attempt_id!, 'test-investigation');
    await held.promise; // Real order workflow has an availability wait before release.
    await api.getInvestigationResult(request.investigation_attempt_id!, 'result-order');
  });
  const completion = api.recordCompletion(request.investigation_attempt_id!, {
    summaryCompleted: true, safetyNettingCompleted: false, ideasConcernsExpectationsCompleted: false,
  });
  const debrief = api.requestDebrief(request, new AbortController().signal);
  await turn();
  assert.deepEqual(calls, ['orders', 'completion']);
  held.release();
  await Promise.all([background, completion, debrief]);
  assert.deepEqual(calls, ['orders', 'completion', 'result-order', 'recovery', 'evaluate']);
});

test('a failed in-flight mutation blocks grading even if its UI caller handles the error', async () => {
  const held = gate();
  const calls: string[] = [];
  const api = runtime(async (url) => {
    calls.push(String(url));
    await held.promise;
    return Response.json({ detail: 'background write failed' }, { status: 503 });
  });
  const background = api.recordPrescription(request.investigation_attempt_id!, {
    medicationId: 'fixture', dose: '', duration: '', prescribedAt: 1,
  }).catch(() => undefined);
  const debrief = api.requestDebrief(request, new AbortController().signal);
  const rejected = assert.rejects(debrief, /background write failed/);
  await turn(); held.release();
  await Promise.all([background, rejected]);
  assert.equal(calls.length, 1);
});

test('concurrent debrief callers reuse one cached evaluation without resubmitting evidence', async () => {
  let saved = false;
  let posts = 0;
  const evaluate = client(async (url) => {
    await turn();
    if (String(url).endsWith('/recovery')) return Response.json({ evaluationResult: saved ? result : null, evaluationActive: false });
    if (url === '/api/local-ai/evaluate') { posts++; saved = true; }
    return Response.json(url === '/api/local-ai/evaluate' ? result : {});
  });
  await Promise.all([evaluate(withEvidence, new AbortController().signal), evaluate(withEvidence, new AbortController().signal)]);
  assert.equal(posts, 1);
});

test('another instance claiming evaluation during preparation is recovered without an evaluate POST', async () => {
  let recoveries = 0;
  let writes = 0;
  const evaluate = client(async (url) => {
    if (String(url).endsWith('/recovery')) {
      recoveries++;
      return Response.json({ evaluationActive: recoveries === 2, evaluationResult: recoveries === 3 ? result : null });
    }
    assert.match(String(url), /\/prescriptions$/);
    writes++;
    return Response.json({ detail: 'This encounter is being evaluated or is complete.' }, { status: 409 });
  });
  assert.equal((await evaluate(withEvidence, new AbortController().signal)).case_id, result.case_id);
  assert.equal(writes, 1);
  assert.equal(recoveries, 3);
});

test('evaluation claim race recovers pending result without repeating the evaluation POST', async () => {
  let recoveries = 0;
  let posts = 0;
  const evaluate = client(async (url) => {
    if (String(url).endsWith('/recovery')) {
      recoveries++;
      return Response.json({ evaluationActive: recoveries === 2, evaluationResult: recoveries === 3 ? result : null });
    }
    posts++;
    return Response.json({ detail: 'An evaluation is already in progress for this encounter.' }, { status: 409 });
  });
  await evaluate(request, new AbortController().signal);
  assert.equal(posts, 1);
  assert.equal(recoveries, 3);
});

test('transaction busy and expired-lease errors remain preparation failures, without grading or hidden write retries', async () => {
  for (const detail of ['Encounter update in progress. Try again shortly.', 'Encounter update lease expired. Recover and try again.']) {
    let gets = 0;
    let writes = 0;
    const evaluate = client(async (url) => {
      if (String(url).endsWith('/recovery')) {
        gets++;
        if (gets > 1 && detail.includes('in progress')) return Response.json({ detail: 'busy' }, { status: 409 });
        return Response.json({ evaluationActive: false, evaluationResult: null });
      }
      assert.match(String(url), /\/prescriptions$/);
      writes++;
      return Response.json({ detail }, { status: 409 });
    });
    await assert.rejects(evaluate(withEvidence, new AbortController().signal), (error: Error) => error.message === detail);
    assert.equal(writes, 1);
    assert.equal(gets, 2);
  }
});

test('pending dialogue and a lost pending evaluation never silently dispatch grading', async () => {
  for (const kind of ['dialogue', 'lost-evaluation']) {
    let gets = 0;
    const evaluate = client(async (url) => {
      assert.match(String(url), /\/recovery$/);
      gets++;
      return Response.json({ evaluationActive: kind === 'lost-evaluation' && gets === 1, evaluationResult: null,
        pendingDialogueRequestIds: kind === 'dialogue' ? ['unacknowledged-request'] : [] });
    });
    await assert.rejects(evaluate(withEvidence, new AbortController().signal), kind === 'dialogue' ? /pending delivery/ : /retry manually/);
    assert.equal(gets, kind === 'dialogue' ? 1 : 2);
  }
});

test('per-attempt queue allows other encounters and skips an aborted queued write without a retry', async () => {
  const held = gate();
  const calls: string[] = [];
  const api = runtime(async (url) => {
    calls.push(String(url));
    if (String(url).includes('/held/')) await held.promise;
    return Response.json({});
  });
  const first = api.recordExamination('held', 'fixture', 1);
  const controller = new AbortController();
  const cancelled = api.submitDiagnosis('held', 'fixture', controller.signal);
  const rejection = assert.rejects(cancelled, /Aborted/);
  controller.abort();
  await api.submitDiagnosis('other-encounter', 'fixture');
  assert.equal(calls.length, 2);
  held.release();
  await Promise.all([first, rejection]);
  assert.equal(calls.length, 2);
});

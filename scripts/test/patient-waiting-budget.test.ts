import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import type { requestPatientText } from '../../src/voice/patientTextRequest.ts';
import type { PatientTextRequestLifecycle } from '../../src/voice/PatientTextRequestLifecycle.ts';

// Exercise the actual fetch/SSE reader and cancellation owner, without a server,
// inference, audio, or a replacement implementation of the production parser.
const bundled = buildSync({
  stdin: {
    contents: `export { requestPatientText } from './patientTextRequest';
      export { PatientTextRequestLifecycle } from './PatientTextRequestLifecycle';`,
    resolveDir: resolve(import.meta.dirname, '../../src/voice'),
  },
  bundle: true, platform: 'node', format: 'cjs', write: false,
}).outputFiles[0].text;

function fixture() {
  const module = { exports: {} as {
    requestPatientText: typeof requestPatientText;
    PatientTextRequestLifecycle: typeof PatientTextRequestLifecycle;
  } };
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal;
  let readerCancelled = 0;
  let calls = 0;
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { readerCancelled++; },
  });
  runInNewContext(bundled, {
    module, exports: module.exports, crypto, TextDecoder, AbortController,
    fetch: async (_url: string, init: RequestInit) => {
      calls++;
      signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => controller.error(new DOMException('Cancelled', 'AbortError')), { once: true });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    },
  });
  const lifecycle = new module.exports.PatientTextRequestLifecycle((request, abort) =>
    module.exports.requestPatientText(request, abort, async () => 'disposable-owner-bound-attempt', () => {}));
  const enqueue = (event: object) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  return {
    lifecycle, enqueue, close: () => controller.close(), signal: () => signal,
    body, calls: () => calls, readerCancelled: () => readerCancelled,
  };
}

const request = { text: 'A scripted semantic question', source: 'typed' as const, requestId: 'offline-only' };
const flush = () => new Promise<void>((done) => setImmediate(done));

test('real SSE client accepts terminal done after the full eight-second waiting budget', { timeout: 15000 }, async () => {
  const f = fixture();
  const started = performance.now();
  let settled = false;
  const pending = f.lifecycle.run(request).finally(() => { settled = true; });
  await flush();
  f.enqueue({ text: 'Scripted grounded answer.' });
  try {
    await new Promise<void>((done) => setTimeout(done, 8050));
    assert.equal(settled, false, 'partial text is not a completed answer');
    assert.equal(f.signal().aborted, false, 'no hidden frontend deadline');
    f.enqueue({ done: true, provenance: 'openrouter', actualModel: 'scripted-only' });
    const result = await pending;
    assert.equal(result.kind, 'completed');
    if (result.kind === 'completed') assert.equal(result.response.text, 'Scripted grounded answer.');
    assert.ok(performance.now() - started >= 8000);
    assert.equal(f.calls(), 1);
    assert.equal(f.readerCancelled(), 1);
    assert.equal(f.body.locked, false);
  } finally { f.lifecycle.dispose(); }
});

test('explicit cancellation interrupts the SSE read and never completes partial text or retries', async () => {
  const f = fixture();
  const pending = f.lifecycle.run(request);
  await flush();
  f.enqueue({ text: 'Partial text' });
  await flush();
  f.lifecycle.cancel();
  assert.equal((await pending).kind, 'cancelled');
  assert.equal(f.signal().aborted, true);
  assert.equal(f.calls(), 1);
  assert.equal(f.body.locked, false);
  assert.equal(f.lifecycle.isBusy(), false);
  f.lifecycle.dispose();
});

test('timeout SSE and HTTP 200 EOF without done remain failures without retries', async () => {
  for (const terminal of ['error', 'eof']) {
    const f = fixture();
    const pending = f.lifecycle.run(request);
    const rejected = assert.rejects(pending, (error: { category: string }) =>
      error.category === (terminal === 'error' ? 'response-timeout' : 'model-unavailable'));
    await flush();
    f.enqueue({ text: 'Partial text' });
    if (terminal === 'error') f.enqueue({ error: 'Scripted timeout', category: 'response-timeout' });
    else f.close();
    await rejected;
    assert.equal(f.calls(), 1);
    assert.equal(f.body.locked, false);
    f.lifecycle.dispose();
  }
});

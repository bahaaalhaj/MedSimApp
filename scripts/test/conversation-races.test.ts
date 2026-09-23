import assert from 'node:assert/strict';
import test from 'node:test';
import { PatientTextRequestLifecycle } from '../../src/voice/PatientTextRequestLifecycle.ts';
import { OrderedAudioQueue, type AudioJob } from '../../src/voice/OrderedAudioQueue.ts';
import { CompletionGate } from '../../src/game/CompletionGate.ts';
import { canStartPatientText } from '../../src/voice/ConversationState.ts';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const job = (turnId: string): AudioJob => ({ turnId, text: turnId, isOpeningGreeting: false, cacheable: true });

test('rapid predefined questions keep one patient-text request authoritative', async () => {
  const firstResponse = deferred<string>();
  const lifecycle = new PatientTextRequestLifecycle(async (_request, signal) => {
    await firstResponse.promise;
    if (signal.aborted) return { kind: 'cancelled' } as const;
    return { kind: 'completed', response: 'first answer' } as const;
  });

  const first = lifecycle.run({ text: 'first', source: 'predefined', questionId: 'q1' });
  const second = await lifecycle.run({ text: 'second', source: 'predefined', questionId: 'q2' });
  assert.deepEqual(second, { kind: 'busy' });
  firstResponse.resolve('ready');
  assert.deepEqual(await first, { kind: 'completed', response: 'first answer' });
});

test('typed questions remain blocked while ordered audio is playing', async () => {
  const playback = deferred<void>();
  const queue = new OrderedAudioQueue({
    synthesize: async (item) => item.text,
    play: async () => playback.promise,
    stop: () => playback.resolve(),
  });
  queue.enqueue(job('opening'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(queue.isBusy(), true);
  assert.equal(canStartPatientText('speaking', false, queue.isBusy()), false);
  playback.resolve();
  await queue.waitForIdle();
  assert.equal(queue.isBusy(), false);
});

test('navigation during synthesis aborts work before playback', async () => {
  let aborted = false;
  let played = 0;
  const queue = new OrderedAudioQueue({
    synthesize: async (_item, signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }),
    play: async () => { played += 1; },
    stop: () => undefined,
  });
  queue.enqueue(job('pending'));
  await Promise.resolve();
  queue.dispose();
  await queue.waitForIdle();
  assert.equal(aborted, true);
  assert.equal(played, 0);
});

test('finish during playback stops the active source and drains pending audio', async () => {
  const playback = deferred<void>();
  let stops = 0;
  const queue = new OrderedAudioQueue({
    synthesize: async (item) => item.text,
    play: async () => playback.promise,
    stop: () => { stops += 1; playback.resolve(); },
  });
  queue.enqueue(job('active'));
  queue.enqueue(job('pending'));
  await Promise.resolve();
  await Promise.resolve();
  queue.dispose();
  await queue.waitForIdle();
  assert.equal(stops, 1);
  assert.equal(queue.getState('active'), 'skipped');
  assert.equal(queue.getState('pending'), 'error');
});

test('a disposed patient-text lifecycle cannot commit a late response', async () => {
  const response = deferred<string>();
  const lifecycle = new PatientTextRequestLifecycle(async () => {
    const text = await response.promise;
    return { kind: 'completed', response: text } as const;
  });
  const pending = lifecycle.run({ text: 'old patient', source: 'typed' });
  lifecycle.dispose();
  response.resolve('late response');
  assert.deepEqual(await pending, { kind: 'cancelled' });
});

test('TTS failure leaves the turn replayable in queue order', async () => {
  let attempts = 0;
  const played: string[] = [];
  const queue = new OrderedAudioQueue({
    synthesize: async (item) => {
      attempts += 1;
      if (attempts === 1) throw new Error('tts unavailable');
      return item.text;
    },
    play: async (_audio, item) => { played.push(item.turnId); },
    stop: () => undefined,
  });
  queue.enqueue(job('response'));
  await queue.waitForIdle();
  assert.equal(queue.getState('response'), 'error');
  queue.enqueue(job('response'));
  await queue.waitForIdle();
  assert.deepEqual(played, ['response']);
  assert.equal(queue.getState('response'), 'played');
});

test('duplicate finish clicks enter the completion path once', () => {
  const gate = new CompletionGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.reset();
  assert.equal(gate.tryStart(), true);
});

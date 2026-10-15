import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import type { Conversation } from '../../src/voice/conversation.ts';
import type { TranscriptRecord } from '../../src/voice/conversationTypes.ts';

// Exercise the real SSE parser, Conversation, transcript commit, and audio queue.
// esbuild is already part of Vite; nothing is written and no new framework is used.
const bundled = buildSync({
  entryPoints: [resolve(import.meta.dirname, '../../src/voice/conversation.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.env': '{"DEV":false}' },
}).outputFiles[0].text;

const flush = async () => { for (let index = 0; index < 5; index++) await new Promise<void>((done) => setImmediate(done)); };

function fixture(provenance: string, options: { ttsFails?: boolean; delayText?: Promise<void>; delayAudio?: Promise<void> } = {}) {
  const transcript: TranscriptRecord[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let ttsFails = options.ttsFails ?? false;
  const module = { exports: {} as { Conversation: typeof Conversation } };
  runInNewContext(bundled, {
    module, exports: module.exports, crypto, performance, TextDecoder, AbortController,
    DOMException, CustomEvent, console, setTimeout, clearTimeout,
    window: { dispatchEvent: () => undefined },
    fetch: async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url === '/agent/patient/stream') {
        await options.delayText;
        return new Response('data: {"text":"It usually happens during spring."}\n\n'
          + `data: ${JSON.stringify({ done: true, provenance, actualModel: null })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } });
      }
      assert.equal(url, '/tts/synthesize');
      await options.delayAudio;
      if (ttsFails) return Response.json({ detail: 'Local speech unavailable.' }, { status: 503 });
      return new Response(new Uint8Array([1, 2]), { headers: { 'X-Patient-TTS-Voice': 'af_heart' } });
    },
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    state: 'running', destination: {},
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node(), frequencyBinCount: 128 }),
    decodeAudioData: async () => ({}),
    createBufferSource: () => {
      const source = { ...node(), onended: null as (() => void) | null,
        start: () => queueMicrotask(() => source.onended?.()), stop() {}, buffer: null };
      return source;
    },
  } as unknown as AudioContext;
  const conversation = new module.exports.Conversation(context, {}, {
    initialMessage: { role: 'assistant', content: 'Hello, doctor.' },
    speakerGender: 'F', isPediatric: false, caseId: 'allergy-001', caseVersion: '1',
    ensureAttempt: async () => 'owner-bound-attempt-fixture',
    onTranscript: (entry) => transcript.push(entry), onAuthorizedAnswer: () => undefined,
  });
  return { conversation, transcript, calls, restoreTts: () => { ttsFails = false; } };
}

test('every public provenance commits one answer then synthesizes once through the existing path', async () => {
  for (const provenance of ['deterministic-authored', 'openrouter', 'safe-unknown']) {
    const { conversation, transcript, calls } = fixture(provenance);
    await conversation.init();
    await conversation.init();
    await flush();
    assert.equal(transcript.length, 1);
    assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 1);
    assert.equal(await conversation.sendTextMessage('Which season is worst?', 'typed'), true);
    // Text is committed independently of the optional synthesis worker.
    assert.equal(transcript.length, 3);
    assert.equal(transcript[2].content, 'It usually happens during spring.');
    assert.equal(transcript[2].patientProvenance, provenance);
    await flush();
    assert.equal(calls.filter((c) => c.url === '/agent/patient/stream').length, 1);
    const audio = calls.filter((c) => c.url === '/tts/synthesize');
    assert.equal(audio.length, 2); // one greeting plus one answer
    assert.equal(audio[1].body.text, transcript[2].content);
    assert.equal(audio[1].body.cacheable, provenance !== 'openrouter');
    assert.equal(conversation.getMessages().length, 3);
    conversation.dispose();
  }
});

test('a pending grounded question cannot duplicate requests, transcript evidence, or synthesis', async () => {
  let release!: () => void;
  const delayed = new Promise<void>((done) => { release = done; });
  const { conversation, transcript, calls } = fixture('deterministic-authored', { delayText: delayed });
  const first = conversation.sendTextMessage('Which season?', 'typed');
  assert.equal(await conversation.sendTextMessage('Which season?', 'typed'), false);
  release();
  assert.equal(await first, true);
  await flush();
  assert.equal(transcript.length, 2);
  assert.equal(calls.filter((c) => c.url === '/agent/patient/stream').length, 1);
  assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 1);
  conversation.dispose();
});

test('TTS unavailability preserves grounded text and permits replay without another patient turn', async () => {
  const { conversation, transcript, calls, restoreTts } = fixture('safe-unknown', { ttsFails: true });
  assert.equal(await conversation.sendTextMessage('An unsupported question', 'typed'), true);
  await flush();
  const message = conversation.getMessages().at(-1)!;
  assert.equal(conversation.getAudioTurnState(message.audioTurnId!), 'error');
  assert.equal(transcript.length, 2);
  restoreTts();
  conversation.replayTurn(message.audioTurnId!);
  await flush();
  assert.equal(conversation.getAudioTurnState(message.audioTurnId!), 'played');
  assert.equal(transcript.length, 2);
  assert.equal(calls.filter((c) => c.url === '/agent/patient/stream').length, 1);
  assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 2);
  conversation.dispose();
});

test('grounded text and transcript remain visible with a clear state while cold speech is pending', async () => {
  let release!: () => void;
  const delayAudio = new Promise<void>((done) => { release = done; });
  const { conversation, transcript, calls } = fixture('safe-unknown', { delayAudio });
  assert.equal(await conversation.sendTextMessage('Do you have allergies?', 'typed'), true);
  await flush();
  assert.equal(transcript.length, 2);
  assert.equal(conversation.getMessages().at(-1)?.content, transcript[1].content);
  assert.equal(conversation.getStatus(), 'audio-preparing');
  assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 1);
  release();
  await flush();
  assert.equal(conversation.getStatus(), 'ready');
  conversation.dispose();
});

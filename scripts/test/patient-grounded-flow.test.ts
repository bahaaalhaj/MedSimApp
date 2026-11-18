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
const demoBundled = buildSync({
  entryPoints: [resolve(import.meta.dirname, '../../src/voice/conversation.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.env': '{"DEV":false,"VITE_MEDSIM_DEPLOYMENT_MODE":"vercel-guest-demo"}' },
}).outputFiles[0].text;

function fixture(provenance: string, options: { demo?: boolean; ttsFails?: boolean; delayText?: Promise<void>; delayAudio?: Promise<void>; providerFails?: boolean; truncated?: boolean; suspended?: boolean; acknowledge?: boolean; ackFails?: boolean; delayAck?: Promise<void>; restored?: boolean } = {}) {
  const transcript: TranscriptRecord[] = [];
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let ttsFails = options.ttsFails ?? false;
  let providerFails = options.providerFails ?? false;
  let truncated = options.truncated ?? false;
  let ackFails = options.ackFails ?? false;
  const authorized: string[] = [];
  const module = { exports: {} as { Conversation: typeof Conversation } };
  runInNewContext(options.demo ? demoBundled : bundled, {
    module, exports: module.exports, crypto, performance, TextDecoder, AbortController,
    DOMException, CustomEvent, console, setTimeout, clearTimeout,
    window: { dispatchEvent: () => undefined },
    fetch: async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (url === '/agent/patient/stream') {
        await options.delayText;
        if (providerFails) return new Response(`data: ${JSON.stringify({ error: 'The patient response service timed out. Your question was not answered. Please retry.', category: 'response-timeout', retryable: true })}\n\n`);
        return new Response('data: {"text":"It usually happens during spring."}\n\n'
          + (truncated ? '' : `data: ${JSON.stringify({ done: true, provenance, actualModel: null, correlationId: body.requestId, requiresAcknowledgement: options.acknowledge, answerShownToTrainee: body.source === 'predefined' ? 'Spring.' : null, relevantPerCase: true })}\n\n`),
          { headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url.endsWith('/dialogue/acknowledgements')) {
        await options.delayAck;
        return Response.json({ requestId: body.requestId, acknowledged: !ackFails }, { status: ackFails ? 503 : 200 });
      }
      assert.equal(url, '/tts/synthesize');
      assert.ok(transcript.some((row) => row.role === 'patient' && row.content === body.text),
        'patient text must be recorded before optional speech dispatch');
      await options.delayAudio;
      if (ttsFails) return Response.json({ detail: 'Local speech unavailable.' }, { status: 503 });
      return new Response(new Uint8Array([1, 2]), { headers: { 'X-Patient-TTS-Voice': 'af_heart' } });
    },
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    state: options.suspended ? 'suspended' : 'running', destination: {},
    resume: async () => { (context as unknown as { state: string }).state = 'running'; },
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node(), frequencyBinCount: 128 }),
    decodeAudioData: async () => ({}),
    createBufferSource: () => {
      const source = { ...node(), onended: null as (() => void) | null,
        start: () => queueMicrotask(() => source.onended?.()), stop() {}, buffer: null };
      return source;
    },
  } as unknown as AudioContext;
  const conversation = new module.exports.Conversation(options.demo ? null : context, {}, {
    ...(options.restored ? { restoredMessages: [
      { role: 'user' as const, content: 'Recovered question.' },
      { role: 'assistant' as const, content: 'Recovered complete answer.', audioTurnId: 'patient-recovered-request-0001' },
    ] } : {}),
    initialMessage: { role: 'assistant', content: 'Hello, doctor.' },
    speakerGender: 'F', isPediatric: false, caseId: 'allergy-001', caseVersion: '1',
    ensureAttempt: async () => 'owner-bound-attempt-fixture',
    onTranscript: (entry) => transcript.push(entry), onAuthorizedAnswer: (id) => authorized.push(id),
  });
  return { conversation, transcript, calls, authorized, restoreAck: () => { ackFails = false; }, restoreTts: () => { ttsFails = false; }, restorePatient: () => { providerFails = false; truncated = false; } };
}

test('complete text is committed before acknowledgement, while optional audio waits for it', async () => {
  let release!: () => void;
  const f = fixture('deterministic-authored', { acknowledge: true, delayAck: new Promise<void>((done) => { release = done; }) });
  const pending = f.conversation.sendTextMessage('Which season?', 'predefined', 'season');
  await flush();
  assert.equal(f.transcript.length, 2);
  assert.equal(f.authorized.length, 1);
  assert.equal(f.conversation.getMessages().at(-1)?.content, f.transcript[1].content);
  assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 0);
  release();
  assert.equal(await pending, true);
  await flush();
  assert.equal(f.transcript.length, 2);
  assert.equal(f.transcript[0].requestId, f.transcript[1].requestId);
  assert.equal(f.calls.filter((row) => row.url.endsWith('/dialogue/acknowledgements')).length, 1);
  assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 1);
  f.conversation.dispose();
});

test('lost acknowledgement retains replay request ID and creates evidence/audio only once on manual retry', async () => {
  const f = fixture('deterministic-authored', { acknowledge: true, ackFails: true });
  assert.equal(await f.conversation.sendTextMessage('Which season?', 'predefined', 'season'), false);
  assert.equal(f.transcript.length, 2);
  assert.equal(f.authorized.length, 1);
  assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 0);
  f.restoreAck();
  await f.conversation.retryLastResponse();
  await flush();
  const turns = f.calls.filter((row) => row.url === '/agent/patient/stream');
  assert.equal(turns.length, 2);
  assert.equal(turns[0].body.requestId, turns[1].body.requestId);
  assert.equal(f.transcript.length, 2);
  assert.equal(f.authorized.length, 1);
  assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 1);
  f.conversation.dispose();
});

test('disposing during acknowledgement cannot add to already accepted text or start stale audio', async () => {
  let release!: () => void;
  const f = fixture('deterministic-authored', { acknowledge: true, delayAck: new Promise<void>((done) => { release = done; }) });
  const pending = f.conversation.sendTextMessage('Which season?', 'predefined', 'season');
  await flush();
  f.conversation.dispose();
  release();
  assert.equal(await pending, false);
  assert.equal(f.transcript.length, 2);
  assert.equal(f.authorized.length, 1);
  assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 0);
});

test('recovered complete text initializes without duplicate evidence or automatic speech', async () => {
  const f = fixture('deterministic-authored', { restored: true });
  await f.conversation.init();
  assert.equal(f.conversation.getMessages().length, 2);
  assert.equal(f.conversation.getStatus(), 'ready');
  assert.equal(f.transcript.length, 0);
  assert.equal(f.calls.length, 0);
  f.conversation.dispose();
});

test('provider timeout stays a retryable system error; question and request ID survive without evidence or audio', async () => {
  const { conversation, transcript, calls, restorePatient } = fixture('openrouter', { providerFails: true });
  const question = 'Which season is worst?';
  assert.equal(await conversation.sendTextMessage(question), false);
  assert.equal(conversation.getStatus(), 'error');
  assert.equal(conversation.getRetryQuestion(), question);
  assert.match(conversation.getLastResponseError(), /service timed out.*not answered.*retry/i);
  assert.equal(conversation.getMessages().length, 1);
  assert.equal(transcript.length, 0);
  assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 0);
  restorePatient();
  await conversation.retryLastResponse();
  await flush();
  const requests = calls.filter((c) => c.url === '/agent/patient/stream');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.question, question);
  assert.equal(requests[1].body.requestId, requests[0].body.requestId);
  assert.equal(transcript.length, 2);
  assert.equal(conversation.getRetryQuestion(), '');
  assert.equal(calls.filter((c) => c.url === '/tts/synthesize').length, 1);
  conversation.dispose();
});

test('interrupted SSE cannot commit partial text; retry uses the same server replay key and authorizes once', async () => {
  const { conversation, transcript, calls, authorized, restorePatient } = fixture('deterministic-authored', { truncated: true });
  assert.equal(await conversation.sendTextMessage('Which season?', 'predefined', 'season'), false);
  assert.equal(transcript.length, 0);
  assert.equal(authorized.length, 0);
  restorePatient();
  await conversation.retryLastResponse();
  await flush();
  const requests = calls.filter((c) => c.url === '/agent/patient/stream');
  assert.equal(requests[0].body.requestId, requests[1].body.requestId);
  assert.equal(transcript.length, 2);
  assert.deepEqual(authorized, ['season']);
  conversation.dispose();
});

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
  assert.equal(await conversation.sendTextMessage('Can I keep asking while audio loads?', 'typed'), true);
  assert.equal(transcript.length, 4);
  release();
  await flush();
  assert.equal(conversation.getStatus(), 'ready');
  conversation.dispose();
});

test('gesture-blocked audio keeps text and reuses decoded bytes after Enable audio and Replay', async () => {
  const { conversation, transcript, calls } = fixture('deterministic-authored', { suspended: true });
  assert.equal(await conversation.sendTextMessage('Tell me your symptoms.'), true);
  await flush();
  assert.match(conversation.getLastAudioError(), /user gesture.*Enable audio/);
  assert.equal(transcript.length, 2);
  await conversation.enableAudio();
  await conversation.replayLastResponse();
  await conversation.replayLastResponse();
  await flush();
  const turnId = conversation.getMessages().at(-1)!.audioTurnId!;
  assert.equal(conversation.getAudioTurnState(turnId), 'played');
  assert.equal(calls.filter((call) => call.url === '/tts/synthesize').length, 1);
  assert.equal(transcript.length, 2);
  conversation.setMuted(true);
  conversation.setVolume(0.2);
  assert.equal(conversation.isMuted(), true);
  assert.equal(conversation.getVolume(), 0.2);
  conversation.dispose();
});

test('Vercel demo accepts/acknowledges text and recovery without Web Audio or synthesis', async () => {
  for (const restored of [false, true]) {
    const f = fixture('openrouter', { demo: true, acknowledge: true, restored });
    await f.conversation.init();
    assert.equal(await f.conversation.sendTextMessage('Which season?'), true);
    await flush();
    await f.conversation.enableAudio();
    await f.conversation.replayLastResponse();
    f.conversation.setMuted(false);
    await flush();
    assert.equal(f.calls.filter((row) => row.url === '/tts/synthesize').length, 0);
    assert.equal(f.calls.filter((row) => row.url.endsWith('/dialogue/acknowledgements')).length, 1);
    assert.equal(f.conversation.getMessages().at(-1)?.content, 'It usually happens during spring.');
    assert.equal(f.conversation.getStatus(), 'ready');
    f.conversation.dispose();
  }
});

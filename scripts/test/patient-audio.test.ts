import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDebriefRequest } from '../../src/agents/debriefRequest.ts';
import type { PatientCase } from '../../src/game/types.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('browser conversation has no doctor audio capture or publication path', () => {
  const conversation = read('src/voice/conversation.ts');
  const player = read('src/components/three/Player.tsx');
  assert.doesNotMatch(conversation, /getUserMedia|setMicrophoneEnabled|MediaRecorder|LocalAudioTrack/);
  assert.doesNotMatch(player, /e\.key === 't'|onTalk/);
});

test('typed and predefined questions use the text-first patient turn', () => {
  const overlay = read('src/components/ExamineOverlay.tsx');
  assert.match(overlay, /sendTextMessage\(q\.question, 'predefined'\)/);
  assert.match(overlay, /sendTextMessage\(text, 'typed'\)/);
});

test('encounter transcript survives in state and reaches debrief request in order', () => {
  const clinicalCase: PatientCase = {
    id: 'transcript-test', name: 'Test Patient', age: 40, gender: 'F', severity: 'stable',
    arrivalBlurb: 'Comfortable', chiefComplaint: 'Pain',
    vitals: { hr: 80, bp: '120/80', spo2: 99, temp: 36.7, rr: 16 },
    anamnesis: [], testResults: [], correctDiagnosisId: 'dx', acceptableTreatmentIds: [],
    criticalTreatmentIds: [], diagnosisOptions: ['dx'],
  };
  const now = Date.now();
  const transcript = [
    { id: '1', role: 'trainee' as const, content: 'When did it start?', timestampIso: new Date(now).toISOString(), questionSource: 'typed' as const, caseId: clinicalCase.id, caseVersion: 'v-test', attemptId: 'attempt-1' },
    { id: '2', role: 'patient' as const, content: 'Three days ago.', timestampIso: new Date(now + 1).toISOString(), questionSource: null, caseId: clinicalCase.id, caseVersion: 'v-test', attemptId: 'attempt-1' },
  ];
  const patient = {
    case: clinicalCase, bedIndex: -10, status: 'in-bed', askedQuestionIds: [], transcript,
    encounterAttemptId: 'attempt-1', orderedTestIds: [], testOrderedAt: {}, completedTestIds: [],
    investigationAttemptId: null, investigationAttemptStatus: 'ready', investigationCatalogue: [], investigationOrders: [],
    givenTreatmentIds: [], submittedDiagnosisId: null, arrivedAt: now, deadlineMs: now + 1000,
    caseVersion: 'v-test', rubricVersion: 'r-test', variantSeed: 'seed', prescriptions: [],
  } as const;
  const request = buildDebriefRequest(clinicalCase, patient as never, now + 1000);
  assert.deepEqual(request.encounter_log.transcript.map((entry) => entry.content), ['When did it start?', 'Three days ago.']);
  assert.equal(request.encounter_log.transcript[0].question_source, 'typed');
  assert.equal(request.encounter_log.transcript[0].attempt_id, 'attempt-1');
});

test('patient audio uses Web Audio buffers without DOM audio or object URLs', () => {
  const conversation = read('src/voice/conversation.ts');
  assert.match(conversation, /decodeAudioData/);
  assert.match(conversation, /createBufferSource/);
  assert.doesNotMatch(conversation, /createObjectURL|document\.createElement\(['"]audio|appendChild/);
  assert.ok(conversation.indexOf("role: 'patient', content: cleanResponse") < conversation.indexOf('await this.synthesizeAndPlay(cleanResponse)'), 'patient text must be recorded before optional speech');
  assert.match(conversation, /setMuted\(muted: boolean\)/);
  assert.match(conversation, /setVolume\(volume: number\)/);
  assert.match(conversation, /replayLastResponse/);
  assert.match(conversation, /retrySpeech/);
  assert.match(conversation, /setStatus\('speaking'\)/);
  assert.match(conversation, /source\.onended/);
});

test('removed cloud speech providers and transport are absent from runtime manifests', () => {
  const manifest = read('package.json');
  const backend = read('backend/requirements.txt');
  assert.doesNotMatch(manifest, /livekit/i);
  assert.doesNotMatch(backend, /livekit|deepgram|cartesia/i);
});

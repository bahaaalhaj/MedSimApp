import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDebriefRequest } from '../../src/agents/debriefRequest.ts';
import { isPediatric, parentGenderForId } from '../../src/voice/patientPersona.ts';
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
  const overlay = [
    read('src/components/ExamineOverlay.tsx'),
    read('src/components/examine/HistoryTab.tsx'),
    read('src/components/examine/ExaminationTab.tsx'),
    read('src/components/examine/ChatTab.tsx'),
  ].join('\n');
  assert.match(overlay, /sendTextMessage\((q|question)\.question, 'predefined', (q|question)\.id\)/);
  assert.match(overlay, /sendTextMessage\(text, 'typed'\)/);
  assert.doesNotMatch(overlay, /patient could not respond/i);
  assert.match(overlay, /getLastResponseError/);
});

test('local patient contract is attempt-bound and greeting is deterministic', () => {
  const client = read('src/voice/localPatient.ts');
  const conversation = read('src/voice/conversation.ts');
  const persona = read('src/voice/patientPersona.ts');
  assert.match(client, /JSON\.stringify\(\{ attemptId, question, source, questionId, requestId \}\)/);
  assert.match(client, /crypto\.randomUUID\(\)/);
  assert.match(client, /PatientResponseProvenance/);
  assert.match(client, /actualModel/);
  assert.doesNotMatch(client, /systemPrompt|baseUrl|model:/);
  assert.match(persona, /Hello, doctor\. I came in because/);
  assert.match(conversation, /this\.state\.getStatus\(\) !== 'uninitialized'/);
  assert.match(read('src/game/store.ts'), /this\.investigationInitPromise && this\.investigationInitEncounterKey === targetEncounterKey/);
});

test('adult and pediatric Kokoro speaker policies remain deterministic', () => {
  const adult = { age: 40 } as PatientCase;
  const child = { age: 7 } as PatientCase;
  assert.equal(isPediatric(adult), false);
  assert.equal(isPediatric(child), true);
  assert.equal(parentGenderForId('peds-001'), parentGenderForId('peds-001'));
  assert.ok(['M', 'F'].includes(parentGenderForId('peds-001')));
  const wiring = read('src/voice/conversationStore.ts');
  assert.match(wiring, /isPediatric\(patientCase\)[\s\S]*parentGenderFor\(patientCase\)[\s\S]*patientCase\.gender/);
});

test('encounter transcript survives in state but is not resubmitted as evaluation authority', () => {
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
    case: clinicalCase, bedIndex: -10, status: 'in-bed', askedQuestionIds: [], transcript, examinationActions: [],
    encounterAttemptId: 'attempt-1', orderedTestIds: [], testOrderedAt: {}, completedTestIds: [],
    investigationAttemptId: null, investigationAttemptStatus: 'ready', investigationCatalogue: [], investigationOrders: [],
    givenTreatmentIds: [], submittedDiagnosisId: null, arrivedAt: now, deadlineMs: now + 1000,
    caseVersion: 'v-test', rubricVersion: 'r-test', variantSeed: 'seed', prescriptions: [],
  } as const;
  const request = buildDebriefRequest(clinicalCase, patient as never, now + 1000);
  assert.equal(patient.transcript.length, 2);
  assert.equal('transcript' in request.encounter_log, false);
  assert.equal(request.case_id, 'transcript-test');
});

test('patient audio uses Web Audio buffers without DOM audio or object URLs', () => {
  const conversation = read('src/voice/conversation.ts');
  const synthesis = read('src/voice/ttsSynthesis.ts');
  const playback = read('src/voice/WebAudioPlayback.ts');
  const queue = read('src/voice/OrderedAudioQueue.ts');
  assert.match(synthesis, /decodeAudioData/);
  assert.match(playback, /createBufferSource/);
  assert.doesNotMatch(conversation + synthesis + playback, /createObjectURL|document\.createElement\(['"]audio|appendChild/);
  const transcriptAt = conversation.indexOf("role: 'patient', content: response.text");
  const speechAt = conversation.indexOf('this.enqueueSpeech(', transcriptAt);
  assert.ok(transcriptAt >= 0 && speechAt > transcriptAt, 'patient text must be recorded before optional speech');
  assert.match(queue, /while \(!this\.disposed && this\.queue\.length\)/);
  assert.match(conversation, /replayTurn\(turnId: string\)/);
  assert.match(synthesis, /signal,/);
  assert.match(queue, /this\.controller\?\.abort\(\)/);
  assert.match(conversation, /patientProvenance/);
  assert.match(conversation, /actualModel/);
  assert.match(conversation, /setMuted\(muted: boolean\)/);
  assert.match(conversation, /setVolume\(volume: number\)/);
  assert.match(conversation, /replayLastResponse/);
  assert.match(conversation, /retrySpeech/);
  assert.match(conversation, /setStatus\('speaking'\)/);
  assert.match(playback, /source\.onended/);
});

test('removed cloud speech providers and transport are absent from runtime manifests', () => {
  const manifest = read('package.json');
  const backend = read('backend/requirements.txt');
  assert.doesNotMatch(manifest, /livekit/i);
  assert.doesNotMatch(backend, /livekit|deepgram|cartesia/i);
});

test('Examine has click and guarded E access and records attempt-bound actions', () => {
  const encounter = read('src/components/EncounterScreen.tsx');
  const overlay = [
    read('src/components/ExamineOverlay.tsx'),
    read('src/components/examine/ExaminationTab.tsx'),
  ].join('\n');
  const storeSource = read('src/game/store.ts');
  assert.match(encounter, /aria-label="Examine patient"/);
  assert.match(encounter, /e\.key !== 'e' && e\.key !== 'E'/);
  assert.match(encounter, /tagName === 'INPUT'[\s\S]*tagName === 'TEXTAREA'[\s\S]*isContentEditable/);
  assert.match(overlay, /onRecordAction=\{\(actionId\) => store\.recordExaminationAction\(actionId\)\}/);
  assert.match(storeSource, /actionId, performedAt, attemptId: p\.investigationAttemptId \?\? p\.encounterAttemptId/);
  assert.match(storeSource, /recordExamination\(attemptId, actionId, performedAt\)/);
});

test('patient audio is ordered and every accepted turn has replayable state', () => {
  const conversation = read('src/voice/conversation.ts');
  const queue = read('src/voice/OrderedAudioQueue.ts');
  assert.match(queue, /PatientAudioState = 'queued' \| 'preparing' \| 'playing' \| 'played' \| 'skipped' \| 'error'/);
  assert.match(queue, /this\.queue\.push\(job\)/);
  assert.match(conversation, /Replay to try again/);
  assert.doesNotMatch(conversation, /sendTextMessage[\s\S]{0,500}cancelAll\(\)/);
});

test('failed dialogue turns do not become transcript evidence and skipped preparation is recoverable', () => {
  const conversation = read('src/voice/conversation.ts');
  const state = read('src/voice/ConversationState.ts');
  const queue = read('src/voice/OrderedAudioQueue.ts');
  const playback = read('src/voice/WebAudioPlayback.ts');
  assert.match(conversation, /Text and transcript evidence are committed before optional TTS begins/);
  assert.match(conversation, /this\.state\.popMessage\(\)/);
  assert.match(state, /popMessage\(\)/);
  assert.match(queue, /this\.setState\(job\.turnId, 'skipped'\)/);
  assert.match(playback, /private activeTurnId/);
});

test('an in-flight attempt initialization is never reused for a different patient', () => {
  const store = read('src/game/store.ts');
  const conversations = read('src/voice/conversationStore.ts');
  assert.match(store, /private investigationInitEncounterKey/);
  assert.match(store, /this\.investigationInitEncounterKey === targetEncounterKey/);
  assert.match(store, /this\.investigationInitPromise === task/);
  assert.match(store, /isSameEncounter\(current, patient\)/);
  assert.match(conversations, /existing\.encounterKey === encounterKey/);
  assert.match(conversations, /active\.variantSeed !== encounterKey/);
  assert.match(conversations, /active\.caseVersion !== caseVersion/);
});

test('conversation disposal disconnects audio nodes and clears UI timers and subscribers', () => {
  const playback = read('src/voice/WebAudioPlayback.ts');
  const queue = read('src/voice/OrderedAudioQueue.ts');
  const state = read('src/voice/ConversationState.ts');
  const dock = read('src/components/DockedPatientAudioPanel.tsx');
  assert.match(playback, /current\.disconnect\(\)/);
  assert.match(playback, /this\.gain\.disconnect\(\)/);
  assert.match(playback, /this\.analyser\.disconnect\(\)/);
  assert.match(queue, /this\.controller\?\.abort\(\)/);
  assert.match(queue, /this\.subscribers\.clear\(\)/);
  assert.match(state, /this\.messageSubscribers\.clear\(\)/);
  assert.match(dock, /window\.clearTimeout\(attachTimer\)/);
  assert.match(dock, /window\.clearInterval\(tick\)/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('patient text has one bounded hosted deadline and no sequential Pro request', () => {
  const provider = read('backend/local_llm.py');
  assert.match(provider, /patient_timeout_seconds: float = 3\.0/);
  assert.match(provider, /min\(self\.settings\.patient_timeout_seconds, 3\.0\)/);
  assert.match(provider, /return \(self\.settings\.patient_model,\)/);
});

test('Kokoro lifecycle is singleton, preloaded once, offline, queued and cached', () => {
  const tts = read('backend/tts/providers.py');
  const cache = read('backend/tts/kokoro_cache.py');
  assert.match(tts, /if self\._preload_task is not None/);
  assert.match(tts, /asyncio\.Semaphore\(4\)/);
  assert.match(tts, /self\._audio_cache_limit = 64/);
  assert.match(tts, /request\.case_version, normalized, provider\._voice\(request\), round\(speed, 3\), revision/);
  assert.match(cache, /HF_HUB_OFFLINE.*"1"/);
  assert.match(cache, /TRANSFORMERS_OFFLINE.*"1"/);
});

test('deterministic and safe-unknown audio are cacheable while model text is not', () => {
  const conversation = read('src/voice/conversation.ts');
  const synthesis = read('src/voice/ttsSynthesis.ts');
  assert.match(conversation, /patientProvenance !== 'openrouter'/);
  assert.match(conversation, /cacheable: response\.patientProvenance !== 'openrouter'/);
  assert.match(synthesis, /X-Patient-TTS-Cache/);
});

test('background music is a single long-lived controller that ducks for patient speech', () => {
  const music = read('src/components/BackgroundMusic.tsx');
  assert.match(music, /const music = new MusicController\(\)/);
  assert.match(music, /new Audio\('\/medsim\.mp3'\)/);
  assert.match(music, /medsim:patient-audio/);
  assert.match(music, /DUCKED_VOLUME/);
  assert.doesNotMatch(music, /screen === 'encounter'/);
});

test('actual Finish consultation controls call immediate idempotent finalization', () => {
  const encounter = read('src/components/EncounterScreen.tsx');
  const overlay = [
    read('src/components/ExamineOverlay.tsx'),
    read('src/components/examine/PrescriptionTab.tsx'),
  ].join('\n');
  assert.match(encounter, /onClick=\{\(e\) => \{[\s\S]*endConsultation\(\)/);
  assert.match(overlay, /onClick=\{onFinish\}[\s\S]*Finish consultation/);
  assert.match(encounter, /finishingGateRef\.current\.tryStart\(\)/);
  assert.match(encounter, /finishPolyclinicCase\(true\)[\s\S]*disposePatientConversation\(POLYCLINIC_BED_INDEX\)/);
  assert.doesNotMatch(encounter, /sayFarewell/);
});

test('Finish validation is visible and actionable', () => {
  const encounter = read('src/components/EncounterScreen.tsx');
  const overlay = read('src/components/ExamineOverlay.tsx');
  assert.match(encounter, /!active\?\.submittedDiagnosisId/);
  assert.match(encounter, /Open Examine, choose Diagnose/);
  assert.match(encounter, /role="alert"/);
  assert.match(overlay, /finishError[\s\S]*role="alert"/);
});

test('debrief starts after navigation and delegates deterministic fallback to the backend', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  const hook = read('src/agents/useLocalDebrief.ts');
  const backend = read('backend/medsim_backend/services/evaluation_service.py');
  assert.match(debrief, /status === 'starting' \|\| status === 'idle'/);
  assert.match(debrief, /status === 'streaming'/);
  assert.doesNotMatch(hook, /buildConservativeDeterministicEvaluation/);
  assert.match(hook, /setStatus\('error'\)/);
  assert.match(hook, /12_000/);
  assert.match(backend, /normalize_evaluation\(case, evidence, server_orders, model_result\)/);
});

test('evaluation persistence remains exactly-once guarded', () => {
  const debrief = read('src/components/DebriefScreen.tsx');
  assert.match(debrief, /if \(savedRef\.current\) return/);
  assert.match(debrief, /savedRef\.current = true/);
});

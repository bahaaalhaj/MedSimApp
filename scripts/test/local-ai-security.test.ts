import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('runtime has no Anthropic SDK, key, session, or model identifier', () => {
  const runtime = [
    read('backend/server.py'), read('backend/local_ai.py'), read('backend/local_llm.py'),
    read('backend/requirements.txt'), read('src/voice/localPatient.ts'), read('src/agents/useLocalDebrief.ts'),
  ].join('\n');
  assert.doesNotMatch(runtime, /anthropic|claude-(?:haiku|opus)|ANTHROPIC_API_KEY|MEDSIM_AGENT_ID|MEDSIM_ENV_ID/i);
});

test('OpenRouter configuration and credentials remain backend-only', () => {
  const backend = [read('backend/server.py'), read('backend/local_llm.py'), read('backend/.env.example')].join('\n');
  const frontend = [read('src/voice/localPatient.ts'), read('src/agents/useLocalDebrief.ts'), read('vite.config.ts')].join('\n');
  assert.match(backend, /OPENROUTER_API_KEY/);
  assert.match(backend, /OPENROUTER_MODEL/);
  assert.doesNotMatch(frontend, /OPENROUTER_API_KEY|OPENROUTER_BASE_URL|OPENROUTER_MODEL|Authorization.*Bearer/i);
  assert.doesNotMatch(read('backend/.env.example'), /sk-or-v1-[a-z0-9]{20,}/i);
});

test('hosted defaults reject paid and dynamic-router model selection', () => {
  const provider = read('backend/local_llm.py');
  const example = read('backend/.env.example');
  assert.match(provider, /nex-agi\/nex-n2\.5-mini:free/);
  assert.match(provider, /nex-agi\/nex-n2\.5-pro:free/);
  assert.doesNotMatch(example, /OPENROUTER_MODEL=openrouter\/(?:free|auto)/);
  assert.match(example, /OPENROUTER_ALLOW_PAID_MODELS=false/);
  assert.match(example, /OPENROUTER_FALLBACK_MODELS=nex-agi\/nex-n2\.5-pro:free/);
  assert.match(example, /OPENROUTER_PRO_FALLBACK_ENABLED=false/);
  assert.match(example, /OPENROUTER_TIMEOUT_SECONDS=7/);
  assert.match(example, /MEDSIM_LOCAL_LLM_ENABLED=false/);
  assert.doesNotMatch(example, /^HF_HUB_OFFLINE=/m);
  const cacheGuard = read('backend/tts/kokoro_cache.py');
  assert.match(cacheGuard, /if not status\.ready:/);
  assert.match(cacheGuard, /os\.environ\["HF_HUB_OFFLINE"\] = "1"/);
});

test('server owns prompts and bounds local context and output', () => {
  const server = read('backend/medsim_backend/services/patient_dialogue_service.py');
  const provider = read('backend/local_llm.py');
  const client = read('src/voice/localPatient.ts');
  const browserPersona = read('src/voice/patientPersona.ts');
  assert.match(server, /patient_system_prompt\(case, profile\)/);
  assert.match(server, /patientMessages"\]\[-8:/);
  assert.match(server, /max_tokens=80/);
  assert.match(provider, /"reasoning": \{"effort": "none"\}/);
  assert.doesNotMatch(client, /systemPrompt|base_url|correctDiagnosis|rubric/);
  assert.doesNotMatch(browserPersona, /buildPersona|anamnesis|AUTHORITATIVE PATIENT FACTS/);
});

test('no model, runtime archive, binary, secret, cache, or generated audio is tracked', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  const forbidden = tracked.filter((path) =>
    /\.(?:gguf|safetensors|pt|pth|onnx|zip|exe|dll)$/i.test(path)
    || /(?:^|\/)(?:\.env\.local|local-ai-logs|generated-audio|__pycache__)(?:\/|$)/i.test(path),
  );
  assert.deepEqual(forbidden, []);
  const ignored = execFileSync('git', ['check-ignore', 'backend/data/llm-models/probe.gguf', 'backend/tools/probe.exe'], { cwd: root, encoding: 'utf8' });
  assert.match(ignored, /backend\/data\/llm-models\/probe\.gguf/);
  assert.match(ignored, /backend\/tools\/probe\.exe/);
});

test('server-only local AI manifest has all curated cases', () => {
  const manifest = JSON.parse(read('docs/generated/local-ai-manifest.server.json')) as { cases: unknown[] };
  assert.equal(manifest.cases.length, 72);
  assert.match(read('vite.config.ts'), /docs\/generated\/\*\.server\.json/);
});

test('learner runtime manifest and production imports contain no hidden clinical truth', () => {
  const learner = JSON.parse(read('src/generated/learner-case-manifest.json')) as unknown;
  const serialized = JSON.stringify(learner);
  for (const key of [
    'answer', 'relevant', 'correctDiagnosisId', 'assessmentRubric', 'criticalFailureRules',
    'medicationExpectations', 'allowedReferenceIds', 'structuredResult', 'resultSnapshot',
  ]) assert.doesNotMatch(serialized, new RegExp(`"${key}"`));

  const runtime = [
    read('src/data/cases.ts'), read('src/game/store.ts'), read('src/components/ExamineOverlay.tsx'),
    read('src/components/DebriefScreen.tsx'), read('src/agents/debriefRequest.ts'),
    read('src/agents/useLocalDebrief.ts'), read('src/voice/conversationStore.ts'),
  ].join('\n');
  assert.doesNotMatch(runtime, /from ['"]\.\.\/(?:clinical\/cases|clinical\/variants|data\/polyclinicPatients|data\/autoRubric|clinical\/prescriptionValidation)/);
  assert.doesNotMatch(runtime, /buildConservativeDeterministicEvaluation/);
  assert.match(read('src/clinical/investigationApi.ts'), /evidenceVersion: 2/);
});

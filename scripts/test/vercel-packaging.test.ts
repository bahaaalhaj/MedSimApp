import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
// Same glob grammar used by Vercel's documented excludeFiles contract. This
// dependency is already installed and locked through ESLint.
const minimatch = require('minimatch') as (path: string, pattern: string, options: { dot: boolean }) => boolean;
const root = resolve(import.meta.dirname, '../..');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
const config = JSON.parse(read('vercel.json'));

test('Vercel function packaging retains private required manifests and excludes local runtime/artifacts', () => {
  const pattern = config.functions['api/index.py'].excludeFiles;
  for (const file of ['backend/medsim_backend/demo_runtime.py', 'backend/medsim_backend/redis_store.py',
    'backend/local_ai.py', 'backend/local_llm.py', 'backend/patient_memory.py', 'backend/patient_interpretation.py',
    'docs/generated/curation-manifest.json', 'docs/generated/investigation-manifest.server.json', 'docs/generated/local-ai-manifest.server.json']) {
    assert.equal(minimatch(file, pattern, { dot: true }), false, `required server file excluded: ${file}`);
    assert.ok(existsSync(resolve(root, file)));
  }
  for (const file of ['backend/.env.local', '.env.production', '.codex/private.json', 'backend/data/medsim.db',
    'backend/.venv/Lib/site-packages/torch/__init__.py', 'backend/tts/providers.py', 'backend/auth_system.py',
    'backend/tests/test_tts.py', 'backend/server.py', 'backend/pilot_server.py', 'backend/medsim_backend/runtime.py',
    'backend/medsim_backend/routes/diagnostics.py', 'backend/data/models/model.gguf', 'backend/generated-audio/voice.wav',
    'docs/diagrams/private.drawio', 'docs/generated/clinical-review-workbook.xlsx', 'src/game/store.ts', 'public/medsim.mp3']) {
    assert.equal(minimatch(file, pattern, { dot: true }), true, `private/unnecessary file included: ${file}`);
    assert.equal(minimatch(file, config.functions['api/index.py'].includeFiles, { dot: true }), false,
      `includeFiles would override the exclusion: ${file}`);
  }
  assert.equal(config.framework, 'vite');
  assert.equal(config.outputDirectory, 'dist-demo');
  assert.equal(config.functions['api/index.py'].maxDuration, 30);
  assert.doesNotMatch(read('vercel.json'), /onrender|BACKEND_SHARED_SECRET/);
  assert.equal(existsSync(resolve(root, 'middleware.ts')), false);
  assert.equal(read('api/.python-version').trim(), '3.12');
  const dependencies = read('api/requirements.txt').split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(dependencies, ['fastapi==0.136.1', 'pydantic==2.13.3', 'httpx==0.28.1', 'slowapi==0.1.9']);
  assert.equal(existsSync(resolve(root, 'api/pyproject.toml')), false,
    'a pyproject beside the entry would shadow requirements.txt');
});

test('demo routes expose only production assets, same-origin function, and hash navigation root', () => {
  const routes = config.routes as Array<{ src?: string; dest?: string; status?: number; handle?: string }>;
  const routeFor = (path: string) => routes.find((route) => route.src && new RegExp(`^${route.src}$`).test(path));
  assert.equal(routeFor('/api/attempts')?.dest, '/api/index.py');
  assert.equal(routeFor('/agent/patient/stream')?.dest, '/api/index.py');
  for (const path of ['/tts/synthesize', '/backend/.env.local', '/docs/generated/local-ai-manifest.server.json',
    '/src/main.tsx', '/.env', '/package.json', '/data.sqlite3']) {
    assert.equal(routeFor(path)?.status, 404, path);
  }
  assert.ok(routes.some((route) => route.handle === 'filesystem'));
  assert.match(read('scripts/build-vercel-demo.mjs'), /VITE_MEDSIM_DEPLOYMENT_MODE: 'vercel-guest-demo'/);
});

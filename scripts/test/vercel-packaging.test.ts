import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { validateVercelConfiguration } from '../verify/vercel-configuration.mjs';

const require = createRequire(import.meta.url);
// Same glob grammar used by Vercel's documented excludeFiles contract. This
// dependency is already installed and locked through ESLint.
const minimatch = require('minimatch') as (path: string, pattern: string, options: { dot: boolean }) => boolean;
const { glob } = require('@vercel/build-utils');
const root = resolve(import.meta.dirname, '../..');
const read = (name: string) => readFileSync(resolve(root, name), 'utf8');
const config = JSON.parse(read('vercel.json'));
const packaging = config.functions['api/index.py'];
const excluded = ['backend/medsim_backend/runtime.py', 'backend/medsim_backend/pilot.py',
  'backend/medsim_backend/routes/diagnostics.py'];
const modules = execFileSync('git', ['ls-files', 'backend/medsim_backend'], { cwd: root, encoding: 'utf8' })
  .trim().split(/\r?\n/).filter((path) => path.endsWith('.py') && !excluded.includes(path));
const manifests = ['curation-manifest.json', 'investigation-manifest.server.json', 'local-ai-manifest.server.json']
  .map((name) => `docs/generated/${name}`);
const required = ['api/index.py', ...modules, 'backend/local_ai.py', 'backend/local_llm.py',
  'backend/patient_memory.py', 'backend/patient_interpretation.py', ...manifests];
const forbidden = [...excluded, 'backend/.env.local', '.env.production', '.codex/private.json',
  'backend/data/medsim.db', 'backend/data/medsim.db-wal', 'backend/data/medsim.sqlite3-shm',
  'backend/.venv/Lib/site-packages/torch/__init__.py', 'backend/tts/providers.py', 'backend/auth_system.py',
  'backend/tests/test_tts.py', 'backend/server.py', 'backend/pilot_server.py',
  'backend/data/models/model.gguf', 'backend/generated-audio/voice.wav', 'backend/tools/kokoro/model.onnx',
  'backend/medsim_backend/private.json', 'backend/medsim_backend/records.sqlite',
  'backend/medsim_backend/tts/provider.py', 'backend/medsim_backend/torch/__init__.py',
  'backend/medsim_backend/services/private.db', 'backend/medsim_backend/routes/records.sqlite3',
  'backend/medsim_backend/services/.env.local', 'backend/medsim_backend/routes/.env.py',
  'backend/medsim_backend/services/__pycache__/service.pyc', 'backend/medsim_backend/services/service.log',
  'api/private.json', 'api/.env.local', 'api/auth_system.py', 'api/requirements.txt',
  'docs/diagrams/private.drawio', 'docs/generated/clinical-review-workbook.xlsx',
  'docs/generated/not-a-server-manifest.json', 'src/game/store.ts', 'public/medsim.mp3',
  'dist-demo/assets/index.js', 'node_modules/kokoro/index.js', 'package.json'];

test('complete Vercel schema accepts the config and rejects the actual length blocker and other invalid fields', () => {
  assert.doesNotThrow(() => validateVercelConfiguration(config));
  for (const field of ['excludeFiles', 'includeFiles']) {
    const valid = structuredClone(config);
    valid.functions['api/index.py'][field] = 'x'.repeat(256);
    assert.doesNotThrow(() => validateVercelConfiguration(valid));
    valid.functions['api/index.py'][field] += 'x';
    assert.throws(() => validateVercelConfiguration(valid), /256 characters/);
  }
  for (const change of [
    (c: typeof config) => { c.unknownSetting = true; },
    (c: typeof config) => { c.functions['api/index.py'].unknownSetting = true; },
    (c: typeof config) => { c.functions['api/index.py'].excludeFiles = ['**/*.db']; },
    (c: typeof config) => { c.functions['api/index.py'].maxDuration = 0; },
    (c: typeof config) => { c.routes[0].status = '404'; },
  ]) {
    const invalid = structuredClone(config);
    change(invalid);
    assert.throws(() => validateVercelConfiguration(invalid));
  }
  const modernConstraint = structuredClone(config);
  modernConstraint.functions['api/index.py'].experimentalTriggers = [{ type: 'queue/v2beta', topic: 'offline', retryAfterSeconds: 1 }];
  assert.doesNotThrow(() => validateVercelConfiguration(modernConstraint));
  modernConstraint.functions['api/index.py'].experimentalTriggers[0].retryAfterSeconds = 0;
  assert.throws(() => validateVercelConfiguration(modernConstraint), /greater than|> 0/);
});

test('actual Vercel glob and include-override merge retain only the required source/manifest fixture', async () => {
  // Benign synthetic files only: never enumerate/read local credentials or DBs.
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(resolve(parent, 'medsim-vercel-packaging-'));
  try {
    for (const path of [...required, ...forbidden]) {
      mkdirSync(dirname(resolve(directory, path)), { recursive: true });
      writeFileSync(resolve(directory, path), 'offline fixture');
    }
    const files = await glob('**', { cwd: directory, ignore: [packaging.excludeFiles] });
    // The Python builder merges includeFiles AFTER applying exclusions.
    Object.assign(files, await glob(packaging.includeFiles, directory));
    assert.deepEqual(Object.keys(files).sort(), [...required].sort());
    const explicit = Object.keys(await glob(packaging.includeFiles, directory));
    assert.deepEqual(explicit.sort(), [...manifests].sort());
  } finally {
    assert.equal(dirname(directory), parent);
    assert.ok(directory.startsWith(resolve(parent, 'medsim-vercel-packaging-')));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Vercel function packaging retains private required manifests and excludes local runtime/artifacts', () => {
  const pattern = packaging.excludeFiles;
  for (const file of required) {
    assert.ok(!minimatch(file, pattern, { dot: true }) || minimatch(file, packaging.includeFiles, { dot: true }),
      `required server file excluded: ${file}`);
    assert.ok(existsSync(resolve(root, file)));
  }
  for (const file of forbidden) {
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

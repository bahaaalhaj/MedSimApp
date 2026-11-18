import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type * as Capabilities from '../../src/deploymentCapabilities.ts';

function load(demo: boolean) {
  const bundled = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/deploymentCapabilities.ts')],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    define: { 'import.meta.env': JSON.stringify({ VITE_MEDSIM_DEPLOYMENT_MODE: demo ? 'vercel-guest-demo' : '' }) },
  }).outputFiles[0].text;
  const module = { exports: {} as typeof Capabilities };
  runInNewContext(bundled, { module, exports: module.exports });
  return module.exports;
}

test('demo build starts with audio/accounts disabled and rejects mismatched server capabilities', () => {
  const demo = load(true);
  assert.equal(demo.capabilities().audio, false);
  assert.equal(demo.capabilities().accounts, false);
  assert.throws(() => demo.acceptCapabilities({ deploymentMode: 'ordinary', audio: true, accounts: true }));
  assert.throws(() => demo.acceptCapabilities({ deploymentMode: 'vercel-guest-demo', audio: false, accounts: false }));
  demo.acceptCapabilities({ deploymentMode: 'vercel-guest-demo', audio: false, accounts: false, guestId: `demo_${'g'.repeat(43)}` });
  assert.ok(Object.isFrozen(demo.capabilities()));
});

test('ordinary build retains audio/accounts and rejects demo server configuration', () => {
  const ordinary = load(false);
  assert.equal(ordinary.capabilities().audio, true);
  assert.equal(ordinary.capabilities().accounts, true);
  assert.throws(() => ordinary.acceptCapabilities({ deploymentMode: 'vercel-guest-demo', audio: false, accounts: false }));
  ordinary.acceptCapabilities({ deploymentMode: 'ordinary', audio: true, accounts: true });
});

for (const demo of [false, true]) {
  test(`${demo ? 'demo' : 'ordinary'} music controls render according to deployment capabilities`, () => {
    const bundled = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/components/BackgroundMusic.tsx')],
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
      external: ['react', 'react/jsx-runtime'],
      define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_MEDSIM_DEPLOYMENT_MODE: demo ? 'vercel-guest-demo' : '' }) },
    }).outputFiles[0].text;
    const module = { exports: {} as { MusicToggle: () => ReturnType<typeof createElement> } };
    runInNewContext(bundled, { module, exports: module.exports, require: createRequire(import.meta.url),
      localStorage: { getItem: () => null } });
    const html = renderToStaticMarkup(createElement(module.exports.MusicToggle));
    assert.equal(html.includes('music'), !demo);
  });
}

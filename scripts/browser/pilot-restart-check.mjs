/** Read-only browser acceptance after an operator-controlled pilot restart.
 * Requires the synthetic account/attempt from pilot-acceptance.mjs. Never
 * restarts a service, attaches a personal profile, or permits inference/TTS.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MEDSIM_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEDSIM_BROWSER_BASE_URL || 'http://localhost:8788';
const outputDir = resolve(process.env.MEDSIM_BROWSER_OUTPUT || 'backend/data/browser-acceptance');
const credentials = JSON.parse(await readFile(resolve(outputDir, 'credentials.json'), 'utf8'));
const saved = JSON.parse(await readFile(resolve(outputDir, 'live-attempt.json'), 'utf8'));
const browser = await chromium.launch({ headless: true, timeout: 30_000,
  ...(process.env.MEDSIM_TEST_CHROMIUM ? { executablePath: process.env.MEDSIM_TEST_CHROMIUM } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const prohibited = [];
for (const path of ['/api/local-ai/evaluate', '/agent/patient/stream', '/tts/synthesize']) {
  await context.route('**' + path, async (route) => { prohibited.push(path); await route.abort(); });
}
try {
  await page.goto(base + '/#/auth');
  await page.locator('#login-email').fill(credentials.email);
  await page.locator('#login-password').fill(credentials.password);
  await page.getByRole('button', { name: 'Login →', exact: true }).click();
  await page.waitForURL((url) => url.hash.startsWith('#/gpRoom'));
  assert.equal((await context.request.get(base + '/api/attempts/' + saved.attemptId + '/recovery')).status(), 404);
  const encounters = (await (await context.request.get(base + '/api/progress/encounters')).json()).encounters;
  const persisted = encounters.find((item) => item.patientSnapshot?.investigationAttemptId === saved.attemptId);
  assert.ok(persisted, 'Saved account encounter survives the restart');
  const caseId = persisted.caseId;
  await page.evaluate(({ caseId, attemptId }) => {
    history.replaceState({ medsim: { screen: 'encounter', caseId, attemptId }, medsimIndex: 0 }, '', '#/encounter?case=' + caseId);
  }, { caseId, attemptId: saved.attemptId });
  await page.reload();
  await page.getByRole('heading', { name: 'Encounter unavailable' }).waitFor();
  await page.getByText(/may have expired.*server may have restarted/).waitFor();
  await page.getByRole('button', { name: 'Saved history', exact: true }).click();
  await page.waitForURL((url) => url.hash.startsWith('#/history'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /^Review / }).first().click();
  await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor();
  await page.screenshot({ path: resolve(outputDir, 'mobile-restarted-review.png') });
  assert.deepEqual(prohibited, [], 'Saved review never runs inference or speech');
  const result = { passed: true, oldAttempt: 'unavailable', savedHistory: 'preserved and reopened', inferenceRequests: 0, synthesisRequests: 0 };
  await writeFile(resolve(outputDir, 'restart-results.json'), JSON.stringify(result, null, 2));
  console.log('PASS real restart: old attempt unavailable, account history preserved/reopened, no inference or synthesis');
} finally { await browser.close(); }

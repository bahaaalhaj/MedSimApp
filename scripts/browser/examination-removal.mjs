/** Isolated production-browser check. Use only with a disposable test database.
 * The test server must block external Python networking and disable TTS.
 * No public tunnel, personal browser profile or hosted inference is used.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MEDSIM_PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://localhost:8788';
const output = resolve('backend/data/examination-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, timeout: 30_000,
  ...(process.env.MEDSIM_TEST_CHROMIUM ? { executablePath: process.env.MEDSIM_TEST_CHROMIUM } : {}) });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }); const page = await context.newPage();
    page.setDefaultTimeout(15_000); const errors = []; let creates = 0; let evaluations = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url() === base + '/api/attempts') creates++;
      if (request.method() === 'POST' && request.url() === base + '/api/local-ai/evaluate') evaluations++;
    });
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style'); style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.append(style);
    }));
    const sections = page.locator('[aria-label="Encounter sections"]');
    const button = (name) => sections.getByRole('button', { name: name === 'History' ? /^History/ : name, exact: name !== 'History' });
    try {
      await page.goto(base + '/#/auth'); await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
      await page.getByText('Accept the next patient', { exact: true }).click();
      await page.getByRole('button', { name: 'Examine patient', exact: true }).click();
      await sections.waitFor();
      await page.getByRole('button', { name: 'Enable audio', exact: true }).first().click();
      assert.equal(await sections.getByRole('button').count(), 6);
      for (const removed of ['Examination', 'General observation', 'Review vital signs', 'Focused examination']) {
        assert.equal(await page.getByRole('button', { name: removed, exact: true }).count(), 0);
      }
      for (const label of ['HR', 'BP', 'SpO₂', 'Temp', 'RR']) await page.getByText(label).first().waitFor();
      assert.equal(await button('History').getAttribute('aria-pressed'), 'true');
      for (const name of ['History', 'Chat', 'Order tests', 'Results', 'Diagnose', 'Rx']) {
        const box = await button(name).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width, name + ' fits viewport');
        if (name !== 'Rx') await button(name).click(); else assert.equal(await button(name).isDisabled(), true);
      }
      await button('Results').click(); const count = creates;
      const attempt = await page.evaluate(() => history.state.medsim.attemptId); assert.ok(attempt);
      await page.goBack(); await sections.waitFor({ state: 'hidden' });
      await page.goForward(); await sections.waitFor();
      assert.equal(await button('Results').getAttribute('aria-pressed'), 'true');
      await page.reload(); await sections.waitFor();
      assert.equal(await button('Results').getAttribute('aria-pressed'), 'true');
      assert.equal(creates, count); assert.equal(await page.evaluate(() => history.state.medsim.attemptId), attempt);
      for (const suffix of ['panel=examine&tab=examination', 'panel=examination', 'tab=examination']) {
        await page.evaluate((suffix) => {
          const route = { ...history.state.medsim, examine: true, examineTab: 'examination' };
          history.replaceState({ ...history.state, medsim: route }, '', '#/encounter?case=' + route.caseId + '&' + suffix);
        }, suffix);
        await page.reload(); await sections.waitFor();
        assert.equal(await button('History').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => history.state.medsim.attemptId), attempt);
        assert.equal(page.url().includes('examination'), false);
      }
      await page.keyboard.press('Escape'); await sections.waitFor({ state: 'hidden' });
      await page.goForward(); await sections.waitFor();
      await page.getByTitle('Close (Esc)').locator('../../..').click({ position: { x: 2, y: 2 } });
      await sections.waitFor({ state: 'hidden' }); await page.goForward(); await sections.waitFor();
      await page.screenshot({ path: resolve(output, `tabs-${viewport.width}.png`) });
      await button('Diagnose').click();
      await page.getByText("Pick the most likely diagnosis based on what you've gathered so far.", { exact: true }).locator('..').getByRole('button').first().click();
      await button('Rx').click(); assert.equal(await button('Rx').getAttribute('aria-pressed'), 'true');
      await page.getByTitle('Close (Esc)').click(); await sections.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'End consultation →', exact: true }).click();
      await page.getByText('Examination — Not assessed', { exact: true }).waitFor();
      await page.getByText(/Raw points:.*\/85/).waitFor();
      const view = await (await context.request.get(base + '/api/attempts/' + attempt + '/recovery')).json();
      assert.deepEqual(view.examinations, []);
      assert.equal(view.evaluationResult.domain_scores.data_gathering.max, 50);
      assert.equal(Object.values(view.evaluationResult.domain_scores).reduce((sum, score) => sum + score.max, 0), 85);
      await page.reload(); await page.getByText('Examination — Not assessed', { exact: true }).waitFor();
      assert.equal(evaluations, 1); assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `debrief-${viewport.width}.png`) });
      results.push({ viewport, passed: true, creates, evaluations, examinationActions: 0 });
      console.log('PASS', viewport.width, 'six tabs / vitals / Back Forward / refresh / legacy fallback /85 grading');
    } catch (error) {
      await page.screenshot({ path: resolve(output, `failure-${viewport.width}.png`) }); throw error;
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }

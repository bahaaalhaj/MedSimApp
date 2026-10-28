/** Opt-in production-browser acceptance. Uses isolated contexts, never personal profiles.
 * Run against a dedicated pilot with MEDSIM_BROWSER_BASE_URL and an ignored output dir.
 * Default: no hosted requests. MEDSIM_BROWSER_LIVE=1 permits ONE typed dialogue and
 * ONE evaluation; cached results are reused. Synthetic credentials stay in outputDir.
 * Supply MEDSIM_PLAYWRIGHT_MODULE / MEDSIM_TEST_CHROMIUM when not installed locally.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.MEDSIM_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.MEDSIM_BROWSER_BASE_URL || 'http://localhost:8788';
assert.match(base, /^https?:\/\/[a-z0-9.:-]+$/i);
const outputDir = resolve(process.env.MEDSIM_BROWSER_OUTPUT || 'backend/data/browser-acceptance');
await mkdir(outputDir, { recursive: true });
const live = process.env.MEDSIM_BROWSER_LIVE === '1';
const resume = process.env.MEDSIM_BROWSER_RESUME === '1';
const cachedOnly = process.env.MEDSIM_BROWSER_CACHED === '1';
const results = [];
const budgetPath = resolve(outputDir, 'live-budget.json');
const budget = {};
if (live) {
  let previous;
  try { previous = JSON.parse(await readFile(budgetPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (resume) {
    assert.ok(previous?.dialogue && (cachedOnly ? previous.evaluation : !previous.evaluation), 'Resume requires the corresponding previous bounded live budget');
    Object.assign(budget, previous);
  } else assert.ok(!previous || !Object.keys(previous).length, 'This output directory already used its bounded live budget. Inspect its evidence before intentionally authorizing another run.');
}
assert.ok(!resume || live, 'Resume is only for a partially completed bounded live run');
assert.ok(!cachedOnly || resume, 'Cached checks require resume and never permit another evaluation');
async function claimLive(kind) {
  assert.equal(budget[kind], undefined, `Only one live ${kind} request is permitted`);
  budget[kind] = new Date().toISOString();
  await writeFile(budgetPath, JSON.stringify(budget));
}
const browser = await chromium.launch({ headless: true,
  ...(process.env.MEDSIM_TEST_CHROMIUM ? { executablePath: process.env.MEDSIM_TEST_CHROMIUM } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let evaluationPosts = 0;
let savePosts = 0;
let attemptCreates = 0;
let holdEvaluation = false;
let evaluated;
let evaluationEntered;
const entered = new Promise((done) => { evaluationEntered = done; });
let dialogueFinished;
const dialogueDone = new Promise((done) => { dialogueFinished = done; });
const audio = { requests: 0, order: [], delay: 0, hold: false, release: () => {} };
// Real WebAudio decode/playback of a generated tone; no physical audibility claim.
function wav() {
  const samples = 24000; const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(48000, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 24000) * 1000), 44 + i * 2);
  return buffer;
}
await context.addInitScript(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after { animation: none !important; transition: none !important; }';
    document.head.append(style);
  });
  window.__audioProbe = { starts: 0, stops: 0, resumes: 0, contexts: [] };
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(...args) { super(...args); window.__audioProbe.contexts.push(this); }
    resume() { window.__audioProbe.resumes++; return super.resume(); }
    createBufferSource() {
      const source = super.createBufferSource();
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { window.__audioProbe.starts++; return start(...args); };
      source.stop = (...args) => { window.__audioProbe.stops++; return stop(...args); };
      return source;
    }
  };
});
await context.route('**/tts/synthesize', async (route) => {
  audio.requests++;
  audio.order.push({ opening: Boolean(route.request().postDataJSON().isOpeningGreeting) });
  if (audio.hold) await new Promise((done) => { audio.release = done; });
  if (audio.delay) await new Promise((done) => setTimeout(done, audio.delay));
  await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(), headers: { 'X-Patient-TTS-Cache': 'scripted' } }).catch(() => {});
});
await context.route('**/agent/patient/stream', async (route) => {
  const body = route.request().postDataJSON();
  if (live && body.source === 'typed' && !results.some((item) => item.name === 'live dialogue')) {
    await claimLive('dialogue');
    const response = await route.fetch();
    const frames = (await response.text()).split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
    const last = frames.at(-1);
    results.push({ name: 'live dialogue', http: response.status(), done: Boolean(last?.done), provenance: last?.provenance ?? null,
      category: last?.category ?? null, actualModel: last?.actualModel ?? null, failed: Boolean(last?.error) });
    await writeFile(resolve(outputDir, 'live-attempt.json'), JSON.stringify({ attemptId: body.attemptId, observation: results.at(-1) }));
    await route.fulfill({ response });
    dialogueFinished();
    return;
  }
  await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"text":"Synthetic browser-test reply."}\n\ndata: {"done":true,"provenance":"deterministic-authored"}\n\n' });
});
await context.route('**/api/local-ai/evaluate', async (route) => {
  evaluationPosts++;
  assert.ok(live, 'Evaluation disabled unless MEDSIM_BROWSER_LIVE=1');
  await claimLive('evaluation');
  const pending = route.fetch();
  evaluationEntered();
  const response = await pending;
  evaluated = await response.json();
  if (holdEvaluation) await new Promise((done) => setTimeout(done, 2500));
  await route.fulfill({ response }).catch(() => {});
});
page.on('request', (request) => {
  if (request.method() === 'POST' && request.url() === base + '/api/attempts') attemptCreates++;
  if (request.method() === 'POST' && request.url() === base + '/api/progress/encounters') savePosts++;
});
async function check(name, task) { await task(); results.push({ name, passed: true }); console.log('PASS', name); }
async function screen(name) { await page.waitForURL((url) => url.hash.startsWith('#/' + name)); }
async function openExamine() { await page.getByRole('button', { name: 'Examine patient', exact: true }).click(); await page.getByTitle('Close (Esc)').waitFor(); }
async function goto(path) { await page.goto(base + path); }
async function recovery() {
  const reference = await page.evaluate(() => history.state?.medsim?.attemptId);
  assert.ok(reference);
  return (await context.request.get(base + '/api/attempts/' + reference + '/recovery')).json();
}
async function login(credentials) {
  await goto('/#/auth');
  await page.locator('#login-email').fill(credentials.email);
  await page.locator('#login-password').fill(credentials.password);
  await page.getByRole('button', { name: 'Login →', exact: true }).click(); await screen('gpRoom');
}
try {
  if (!resume) {
  await check('welcome and onboarding arrows / browser Back and Forward', async () => {
    await goto('/#/splash'); await page.getByRole('button', { name: /Tap to begin/ }).click(); await screen('onboarding');
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.getByRole('button', { name: '← Back', exact: true }).click();
    await page.getByRole('heading', { name: 'What this is.', exact: true }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: 'How it works.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await page.getByRole('button', { name: /Take me in/ }).click(); await screen('auth');
    await page.getByRole('button', { name: '← Welcome', exact: true }).click(); await screen('splash');
  });
  }
  let credentials;
  try { credentials = JSON.parse(await readFile(resolve(outputDir, 'credentials.json'), 'utf8')); } catch { /* First run */ }
  await check('isolated synthetic account bootstrap and Secure cookies on loopback localhost', async () => {
    if (credentials) await login(credentials);
    else {
      credentials = { email: `pilot-browser-${Date.now()}@example.com`, password: 'Browser-' + randomBytes(18).toString('hex') };
      await goto('/#/auth'); await page.getByRole('tab', { name: 'Create Account', exact: true }).click();
      await page.locator('#register-name').fill('Pilot Browser Test'); await page.locator('#register-email').fill(credentials.email);
      await page.locator('#register-password').fill(credentials.password); await page.locator('#register-confirm').fill(credentials.password);
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Create Account →', exact: true }).click();
      await screen('gpRoom'); await writeFile(resolve(outputDir, 'credentials.json'), JSON.stringify(credentials));
    }
    const cookies = await context.cookies();
    for (const name of ['medsim_session', 'medsim_guest', 'medsim_csrf']) {
      const cookie = cookies.find((item) => item.name === name); assert.ok(cookie, name);
      assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'Lax'); assert.equal(cookie.domain.startsWith('.'), false);
      assert.equal(cookie.httpOnly, name !== 'medsim_csrf');
    }
  });
  if (!resume) {
  await check('GP / library / history arrows, logo and profile', async () => {
    await page.getByText('Pick from the charts', { exact: true }).click(); await screen('library');
    await page.getByTitle('Back to the GP room').click(); await screen('gpRoom');
    await page.getByRole('button', { name: /Back to corridor/ }).click(); await screen('home');
    await page.getByRole('button', { name: 'See all training history', exact: true }).click(); await screen('history');
    await page.getByRole('button', { name: '← Profile', exact: true }).click(); await screen('home');
    await page.getByTitle('Back to start').click(); await screen('splash');
    await goto('/#/gpRoom'); await page.getByTitle('Open profile').click(); await screen('home');
    await goto('/#/gpRoom');
  });
  await check('mobile viewport profile / logout and library navigation remain reachable', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(outputDir, 'mobile-header.png') });
    for (const title of ['Open profile', 'Back to start']) {
      const box = await page.getByTitle(title).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, title + ' stays within viewport');
    }
    await page.getByTitle('Open profile').click(); await screen('home');
    await goto('/#/gpRoom'); await page.getByText('Pick from the charts', { exact: true }).click(); await screen('library');
    await page.getByTitle('Back to the GP room').click(); await screen('gpRoom');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('active encounter / overlay Back Forward / Close Escape backdrop', async () => {
    audio.hold = true;
    await page.getByText('Accept the next patient', { exact: true }).click(); await screen('encounter');
    await openExamine();
    await page.goBack(); await page.getByTitle('Close (Esc)').waitFor({ state: 'hidden' });
    await page.goForward(); await page.getByTitle('Close (Esc)').waitFor();
    await page.getByTitle('Close (Esc)').click(); await page.getByTitle('Close (Esc)').waitFor({ state: 'hidden' });
    await openExamine(); await page.keyboard.press('Escape'); await page.getByTitle('Close (Esc)').waitFor({ state: 'hidden' });
    await openExamine(); await page.getByTitle('Close (Esc)').locator('../../..').click({ position: { x: 2, y: 2 } });
    await page.getByTitle('Close (Esc)').waitFor({ state: 'hidden' });
    await page.getByText(/Loading polyclinic/).waitFor({ state: 'hidden', timeout: 60_000 });
    await page.screenshot({ path: resolve(outputDir, 'room-front.png') });
    await page.waitForTimeout(100); // Controls remount after the scene leaves Suspense.
    await page.locator('canvas').click({ position: { x: 100, y: 300 } });
    await page.waitForFunction(() => document.pointerLockElement !== null);
    await page.mouse.move(350, 400); await page.waitForTimeout(100);
    await page.screenshot({ path: resolve(outputDir, 'room-look-left.png') });
    await page.mouse.move(50, 400); await page.waitForTimeout(100);
    await page.screenshot({ path: resolve(outputDir, 'room-look-right.png') });
    // CDP's synthetic Escape does not invoke Chromium's native lock-release
    // accelerator. Exercise the app's E-to-Examine release, then overlay Escape.
    await page.keyboard.press('e'); await page.getByTitle('Close (Esc)').waitFor();
    await page.waitForFunction(() => document.pointerLockElement === null);
    await page.keyboard.press('Escape'); await page.getByTitle('Close (Esc)').waitFor({ state: 'hidden' });
  });
  await check('text while speech prepares, explicit Enable / mute / volume', async () => {
    await openExamine();
    await page.getByRole('button', { name: 'Enable audio', exact: true }).first().click();
    await page.getByRole('button', { name: 'Mute patient audio', exact: true }).first().click();
    await page.getByRole('button', { name: 'Unmute patient audio', exact: true }).first().click();
    await page.getByRole('slider', { name: 'Patient audio volume', exact: true }).first().fill('0.35');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: 'Skip audio', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Type a question for the patient').isEnabled(), true);
    await page.getByLabel('Type a question for the patient', { exact: true }).fill('Could you describe how the symptoms started and progressed?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    if (live) await dialogueDone;
    if (!live) await page.getByText('Synthetic browser-test reply.').last().waitFor();
    await page.waitForFunction(() => !document.querySelector('#patient-question')?.disabled, null, { timeout: 25_000 });
    assert.equal(await page.getByLabel('Type a question for the patient').isEnabled(), true);
    const state = await recovery(); assert.ok(state.attemptId);
    // This assertion measures successful server evidence only for the bounded live turn.
    if (live && results.find((item) => item.name === 'live dialogue')?.done) assert.ok(state.transcript.length >= 2);
    audio.hold = false; audio.release();
    await page.waitForFunction(() => window.__audioProbe.starts >= 1);
    await page.getByRole('button', { name: 'Replay', exact: true }).last().waitFor();
    if (!live || results.find((item) => item.name === 'live dialogue')?.done) {
      assert.ok(await page.evaluate(() => window.__audioProbe.starts >= 2), 'Opening and queued answer both play');
      assert.deepEqual(audio.order.slice(0, 2), [{ opening: true }, { opening: false }], 'FIFO synthesis order');
    }
    const requests = audio.requests;
    const starts = await page.evaluate(() => window.__audioProbe.starts);
    await page.getByRole('button', { name: 'Replay', exact: true }).last().click();
    await page.waitForFunction((previous) => window.__audioProbe.starts > previous, starts);
    assert.equal(audio.requests, requests, 'Replay reuses decoded audio');
    await page.getByRole('button', { name: 'Skip', exact: true }).last().click();
    results.push({ name: 'WebAudio playback, decoded replay and Skip', passed: true, physicalAudibility: 'unverified' });
  });
  await check('cancel / confirm unfinished departure, browser Back restores encounter', async () => {
    if (live && !results.find((item) => item.name === 'live dialogue')?.done) {
      // A failed provider turn is not clinical evidence. Record one synthetic
      // learner diagnosis so departure protection can still be exercised.
      await page.getByRole('button', { name: 'Diagnose', exact: true }).click();
      await page.getByText("Pick the most likely diagnosis based on what you've gathered so far.", { exact: true }).locator('..').getByRole('button').first().click();
    }
    await page.getByTitle('Close (Esc)').click();
    await page.waitForURL((url) => !url.hash.includes('panel='));
    let decision = false;
    const dialogs = [];
    const handleDialog = async (dialog) => { dialogs.push(dialog.type()); await (decision ? dialog.accept() : dialog.dismiss()); };
    page.on('dialog', handleDialog);
    await page.getByTitle('Open profile').click(); await screen('encounter');
    await page.waitForTimeout(200); // Let the native confirm close before another gesture.
    assert.equal(await page.evaluate(() => document.pointerLockElement === null), true, 'Profile clicks must not acquire scene pointer lock');
    decision = true;
    await openExamine(); await page.getByRole('button', { name: 'Chat', exact: true }).click();
    audio.hold = true;
    const heldRequests = audio.requests;
    await page.getByRole('button', { name: 'Replay patient response', exact: true }).first().click();
    await page.waitForFunction(() => window.__audioProbe.starts > 0);
    // A decoded replay may finish before departure; a new request must not leak later.
    await page.getByTitle('Close (Esc)').click();
    await page.waitForURL((url) => !url.hash.includes('panel='));
    await page.getByTitle('Open profile').click(); await screen('home');
    const startsAtExit = await page.evaluate(() => window.__audioProbe.starts);
    audio.hold = false; audio.release(); await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__audioProbe.starts), startsAtExit, 'No old patient playback after departure');
    assert.ok(audio.requests >= heldRequests);
    assert.equal(dialogs.length, 2); page.off('dialog', handleDialog);
    await page.goBack(); await screen('encounter'); await page.getByRole('button', { name: 'Examine patient' }).waitFor();
  });
  await check('refresh active encounter does not create another attempt', async () => {
    const before = await recovery(); const count = attemptCreates;
    await page.reload(); await page.getByRole('button', { name: 'Examine patient' }).waitFor();
    const after = await recovery(); assert.equal(after.attemptId, before.attemptId); assert.equal(attemptCreates, count);
    assert.equal(after.transcript.length, before.transcript.length);
  });
  } else {
    const saved = JSON.parse(await readFile(resolve(outputDir, 'live-attempt.json'), 'utf8'));
    results.push(saved.observation);
    const response = await context.request.get(base + '/api/attempts/' + saved.attemptId + '/recovery');
    assert.equal(response.status(), 200); const view = await response.json();
    await page.evaluate(({ attemptId, caseId }) => {
      history.replaceState({ medsim: { screen: 'encounter', caseId, attemptId }, medsimIndex: 0 }, '', '#/encounter?case=' + caseId);
    }, view);
    await page.reload();
    if (cachedOnly) {
      assert.ok(view.evaluationResult, 'Cached-only checks require a completed server result');
      await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor();
    } else await page.getByRole('button', { name: 'Examine patient' }).waitFor();
    results.push({ name: 'resume bounded evaluation after failed live semantic turn', passed: true });
  }
  if (live) {
    if (!cachedOnly) {
    await check('finish, interrupted evaluation connection, refresh and cached safe retry', async () => {
      await openExamine(); await page.getByRole('button', { name: 'Diagnose', exact: true }).click();
      const dx = page.getByText("Pick the most likely diagnosis based on what you've gathered so far.", { exact: true }).locator('..').getByRole('button').first();
      if (await dx.isEnabled()) await dx.click(); await page.getByTitle('Close (Esc)').click();
      // Legacy wrap route remains supported; normal Finish now goes straight to debrief.
      await page.evaluate(() => { location.hash = location.hash.replace('/encounter', '/endConfirm'); }); await screen('endConfirm');
      await page.getByRole('button', { name: /Back to the room/ }).click(); await screen('encounter');
      holdEvaluation = true;
      await page.getByRole('button', { name: 'End consultation →', exact: true }).click(); await screen('debrief');
      await entered;
      for (let i = 0; i < 30; i++) {
        const state = await recovery();
        if (state.evaluationActive || state.evaluationResult) { results.push({ name: 'evaluation before refresh', active: state.evaluationActive, cached: Boolean(state.evaluationResult) }); break; }
        await page.waitForTimeout(100);
      }
      await page.reload();
      await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor({ timeout: 25_000 });
      await page.waitForTimeout(400); const before = await recovery(); assert.ok(before.evaluationResult);
      const savedBefore = await context.request.get(base + '/api/progress/encounters');
      const count = (await savedBefore.json()).encounters.length;
      await page.reload(); await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor(); await page.waitForTimeout(500);
      assert.equal(evaluationPosts, 1); assert.equal((await (await context.request.get(base + '/api/progress/encounters')).json()).encounters.length, count);
      results.push({ name: 'live evaluation', mode: before.evaluationResult.generation.mode, category: before.evaluationResult.generation.error_category,
        provider: before.evaluationResult.generation.provider });
    });
    } else {
      await check('Retry evaluation recovers cached feedback after an injected recovery transport failure', async () => {
        const before = (await (await context.request.get(base + '/api/progress/encounters')).json()).encounters.length;
        let remaining = 2;
        await context.route('**/api/attempts/*/recovery', async (route) => {
          if (--remaining === 0) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Synthetic interrupted recovery"}' });
          else await route.continue();
        });
        await page.reload(); await page.getByRole('button', { name: 'Retry evaluation', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Retry evaluation', exact: true }).click();
        await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor();
        await page.waitForTimeout(500); assert.equal(evaluationPosts, 0);
        assert.equal((await (await context.request.get(base + '/api/progress/encounters')).json()).encounters.length, before);
        await context.unroute('**/api/attempts/*/recovery');
      });
    }
    await check('completed debrief at mobile viewport, saved-review arrow and no repeated evaluation', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload(); await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor();
      await page.screenshot({ path: resolve(outputDir, 'mobile-debrief.png') });
      assert.equal(evaluationPosts, cachedOnly ? 0 : 1);
      await page.getByRole('button', { name: '← Back to polyclinic', exact: true }).click(); await screen('gpRoom');
      await page.getByTitle('Open profile').click(); await screen('home');
      await page.getByRole('button', { name: 'See all training history', exact: true }).click(); await screen('history');
      await page.getByRole('button', { name: /^Review / }).first().click(); await screen('debrief');
      await page.getByText(/^(Deterministic evidence grading|Model-assisted feedback)$/).waitFor();
      await page.getByRole('button', { name: '← Back to history', exact: true }).click(); await screen('history');
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
  }
  await check('valid signed-session reopen without automatic clinical encounter', async () => {
    const count = attemptCreates;
    const reopened = await context.newPage();
    await reopened.goto(base + '/#/auth'); await reopened.waitForURL((url) => url.hash.startsWith('#/gpRoom'));
    assert.equal(await reopened.getByRole('button', { name: 'Examine patient' }).count(), 0);
    assert.equal(attemptCreates, count); await reopened.close();
  });
  await check('same-peer guest and account ownership of attempts and saved reviews', async () => {
    const cases = await (await context.request.get(base + '/api/clinical/cases')).json();
    const create = async (client) => {
      const response = await client.post(base + '/api/attempts', { headers: { Origin: base }, data: { caseId: cases[0].caseId, caseVersion: cases[0].caseVersion } });
      assert.equal(response.status(), 201); return (await response.json()).attemptId;
    };
    const own = await create(context.request);
    const guests = await Promise.all([browser.newContext(), browser.newContext()]);
    for (const guest of guests) await guest.request.get(base + '/api/auth/session');
    const guestId = await create(guests[0].request);
    assert.equal((await guests[1].request.get(base + '/api/attempts/' + guestId + '/recovery')).status(), 404);
    assert.equal((await context.request.get(base + '/api/attempts/' + guestId + '/recovery')).status(), 404);
    for (const guest of guests) assert.equal((await guest.request.get(base + '/api/attempts/' + own + '/recovery')).status(), 404);
    const account = await browser.newContext(); const session = await (await account.request.get(base + '/api/auth/session')).json();
    const registered = await account.request.post(base + '/api/auth/register', { headers: { Origin: base, 'x-csrf-token': session.csrfToken },
      data: { display_name: 'Pilot Isolation Test', email: `pilot-isolation-${Date.now()}@example.com`, password: 'Isolation-' + randomBytes(18).toString('hex'), terms_accepted: true } });
    assert.equal(registered.status(), 201);
    assert.equal((await account.request.get(base + '/api/attempts/' + own + '/recovery')).status(), 404);
    const saved = (await (await context.request.get(base + '/api/progress/encounters')).json()).encounters;
    if (saved.length) {
      assert.equal((await account.request.get(base + '/api/progress/encounters/' + saved[0].id)).status(), 404);
      assert.equal((await guests[0].request.get(base + '/api/progress/encounters/' + saved[0].id)).status(), 401);
    }
    await account.close(); await Promise.all(guests.map((guest) => guest.close()));
  });
  await check('missing or expired attempt explains recovery and offers useful actions', async () => {
    await page.evaluate(() => {
      const route = { screen: 'encounter', caseId: 'im-001', attemptId: 'unavailable-browser-test-attempt' };
      history.replaceState({ medsim: route, medsimIndex: 0 }, '', '#/encounter?case=im-001');
    });
    await page.reload(); await page.getByRole('heading', { name: 'Encounter unavailable' }).waitFor();
    await page.getByText(/may have expired.*server may have restarted/).waitFor();
    await page.getByRole('button', { name: 'Retry recovery', exact: true }).click();
    await page.getByRole('heading', { name: 'Encounter unavailable' }).waitFor();
    await page.getByRole('button', { name: 'Choose a case', exact: true }).click(); await screen('gpRoom');
  });
  await check('logout revokes session, reopen and browser Back gate protected pages', async () => {
    await page.getByRole('button', { name: 'Logout', exact: true }).click(); await screen('auth');
    assert.equal((await (await context.request.get(base + '/api/auth/session')).json()).authenticated, false);
    await page.goBack();
    assert.equal(await page.getByRole('button', { name: 'Examine patient' }).count(), 0);
    await goto('/#/encounter'); await page.getByRole('button', { name: 'Login →', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Examine patient' }).count(), 0);
  });
  assert.deepEqual(errors, [], 'No uncaught page errors');
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify({ base, results, errors, evaluationPosts, savePosts, attemptCreates }, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(outputDir, 'failure.png') }).catch(() => {});
  await writeFile(resolve(outputDir, 'failure.txt'), String(error.stack));
  await writeFile(resolve(outputDir, 'results.json'), JSON.stringify({ base, results, errors, evaluationPosts, savePosts, attemptCreates }, null, 2));
  throw error;
} finally { await browser.close(); }

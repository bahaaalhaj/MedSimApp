import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { PilotHistory, type PilotRoute } from '../../src/game/pilotNavigation.ts';
import type { store as actualStore } from '../../src/game/store.ts';
import type { RecoveryView } from '../../src/game/attemptRecovery.ts';

const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/game/store.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  define: { 'import.meta.env': '{"DEV":false}', 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((done) => setImmediate(done)); };

function surface(hash = '#/gpRoom') {
  const listeners = new Set<() => void>();
  const entries: Array<{ hash: string; state: unknown }> = [{ hash, state: null }];
  let index = 0;
  const storage = new Map<string, string>();
  const data = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key), length: 0, key: () => null };
  const win = { location: { hash, hostname: 'example.test' }, localStorage: data, sessionStorage: data,
    history: { state: null as unknown,
      replaceState(state: unknown, _unused: string, url: string) { entries[index] = { state, hash: url }; sync(); },
      pushState(state: unknown, _unused: string, url: string) { entries.splice(index + 1); entries.push({ state, hash: url }); index++; sync(); },
      go(delta: number) { const next = index + delta; if (next < 0 || next >= entries.length) return; index = next; sync(); listeners.forEach((fn) => fn()); },
    },
    addEventListener(_type: string, fn: () => void) { listeners.add(fn); },
    removeEventListener(_type: string, fn: () => void) { listeners.delete(fn); },
    confirm: () => true, dispatchEvent: () => undefined,
  };
  function sync() { win.location.hash = entries[index].hash; win.history.state = entries[index].state; }
  return { win, entries, storage, data };
}

function loadStore(browser: ReturnType<typeof surface>, fetcher: typeof fetch) {
  const module = { exports: {} as { store: typeof actualStore } };
  runInNewContext(bundle, { module, exports: module.exports, window: browser.win,
    sessionStorage: browser.data, localStorage: browser.data, fetch: fetcher, URLSearchParams, crypto,
    AbortController, DOMException, performance, console, setTimeout, clearTimeout });
  return module.exports.store;
}

test('actual history adapter traverses screens and overlay both ways without message entries or back loops', () => {
  const browser = surface();
  const applied: PilotRoute[] = [];
  let allowed = true;
  const nav = new PilotHistory(browser.win, (route) => applied.push(route), () => allowed);
  nav.write({ screen: 'library' });
  nav.write({ screen: 'brief', caseId: 'id-004' });
  nav.write({ screen: 'encounter', caseId: 'id-004' });
  const count = browser.entries.length;
  nav.write({ screen: 'encounter', caseId: 'id-004', attemptId: 'private-reference' });
  assert.equal(browser.entries.length, count, 'server binding replaces the entry');
  nav.write({ screen: 'encounter', caseId: 'id-004', attemptId: 'private-reference' });
  assert.equal(browser.entries.length, count);
  nav.write({ screen: 'encounter', caseId: 'id-004', attemptId: 'private-reference', examine: true });
  assert.equal(nav.backTo('encounter'), true);
  assert.equal(applied.at(-1)?.examine, false);
  browser.win.history.go(1);
  assert.equal(applied.at(-1)?.examine, true);
  allowed = false;
  browser.win.history.go(-2);
  assert.equal(nav.current().examine, true);
  assert.match(browser.win.location.hash, /panel=examine/);
  nav.dispose();
});

test('real Store recovers active, pending and completed routes on refresh without creating another attempt', async () => {
  for (const stage of ['active', 'pending', 'completed'] as const) {
    const browser = surface();
    const calls: string[] = [];
    let view: RecoveryView;
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/recovery')) return Response.json(view);
      assert.equal(url, '/api/attempts');
      return Response.json({ attemptId: 'server-owned-reference-12345', investigations: [], evidenceVersion: 2 });
    };
    const first = loadStore(browser, fetcher);
    first.startNavigation('user:one');
    first.acceptNextPatient('id-004');
    await flush();
    const p = first.getState().polyclinic.patient!;
    view = { attemptId: p.investigationAttemptId!, caseId: p.case.id, caseVersion: p.caseVersion,
      variantSeed: p.variantSeed, clientAttemptId: p.encounterAttemptId, createdAt: p.arrivedAt / 1000, expiresAt: Date.now() / 1000 + 100,
      patientProfile: { displayName: p.case.name, age: p.case.age, chiefComplaint: p.case.chiefComplaint },
      transcript: [{ role: 'patient', content: 'Visible patient reply', timestampIso: String(Date.now() / 1000), questionSource: null }],
      visibleAnswers: {}, askedQuestionIds: [], examinations: [], prescriptions: [], submittedDiagnosisId: null,
      completionChecks: null, investigations: [], orders: [], evaluationActive: stage === 'pending',
      evaluationResult: stage === 'completed' ? { generation: 'fixture result' } : null };
    if (stage !== 'active') first.setScreen('debrief');
    first.stopNavigation();
    const second = loadStore(browser, fetcher);
    second.startNavigation('user:one');
    await flush();
    assert.equal(second.getState().recoveryStatus, 'ready');
    assert.equal(second.getState().screen, stage === 'active' ? 'encounter' : 'debrief');
    const restored = second.getState().polyclinic.patient ?? second.getState().lastEncounter;
    assert.equal(restored?.investigationAttemptId, p.investigationAttemptId);
    assert.equal(restored?.transcript.length, 1);
    assert.equal(calls.filter((url) => url === '/api/attempts').length, 1);
    const serialized = [...browser.storage.values()].join('');
    assert.doesNotMatch(serialized, /Visible patient reply|rubric|correctDiagnosis/);
    second.stopNavigation();
  }
});

test('real Store handles missing recovery explicitly and logout clears private state across Back', async () => {
  const browser = surface('#/encounter');
  browser.win.history.state = { medsim: { screen: 'encounter', attemptId: 'expired-attempt-reference' }, medsimIndex: 0 };
  const store = loadStore(browser, async () => Response.json({ detail: 'attempt not found' }, { status: 404 }));
  store.startNavigation('user:one');
  await flush();
  assert.equal(store.getState().recoveryStatus, 'error');
  assert.match(store.getState().navigationNotice ?? '', /expired|restarted/);
  store.dismissRecovery();
  assert.equal(store.getState().screen, 'gpRoom');
  store.resetForIdentityExit();
  browser.win.history.go(-1);
  assert.equal(store.getState().screen, 'auth');
  assert.equal(store.getState().polyclinic.patient, null);
  assert.equal(store.getState().lastEncounter, null);
});

test('reopening the root while signed in offers recovery without automatically resuming a case', async () => {
  const browser = surface('#/auth');
  browser.storage.set('medsim:recovery:user:one', JSON.stringify({ screen: 'encounter', attemptId: 'reference' }));
  let requests = 0;
  const store = loadStore(browser, async () => { requests++; throw new Error('must not fetch'); });
  store.startNavigation('user:one');
  await flush();
  assert.equal(store.getState().screen, 'gpRoom');
  assert.equal(store.getState().polyclinic.patient, null);
  assert.equal(store.getState().recoverableEncounter, true);
  assert.equal(requests, 0);
  store.stopNavigation();
});

test('a stale attempt response cannot bind to a replacement patient, and identity exit cannot be cancelled', async () => {
  const browser = surface();
  let firstResolve!: (value: Response) => void;
  let creates = 0;
  const store = loadStore(browser, async () => {
    creates++;
    if (creates === 1) return new Promise<Response>((resolve) => { firstResolve = resolve; });
    return Response.json({ attemptId: 'new-server-attempt-reference', investigations: [] });
  });
  store.startNavigation('user:one');
  store.acceptNextPatient('id-004');
  store.acceptNextPatient('im-003');
  await flush();
  firstResolve(Response.json({ attemptId: 'stale-server-attempt-reference', investigations: [] }));
  await flush();
  assert.equal(store.getState().polyclinic.patient?.case.id, 'im-003');
  assert.equal(store.getState().polyclinic.patient?.investigationAttemptId, 'new-server-attempt-reference');
  store.recordExaminationAction('general-observation');
  browser.win.confirm = () => false;
  store.resetForIdentityExit();
  assert.equal(store.getState().screen, 'auth');
  assert.equal(store.getState().polyclinic.patient, null);
  assert.equal(browser.storage.has('medsim:recovery:user:one'), false);
});

test('public onboarding arrows and browser Back/Forward preserve steps before sign-in', async () => {
  const browser = surface('#/splash');
  const store = loadStore(browser, async () => { throw new Error('public navigation must not create an attempt'); });
  store.startNavigation(null);
  store.beginFromSplash();
  store.setOnboardingStep(1);
  store.setOnboardingStep(2);
  store.backOnboarding();
  await flush();
  assert.equal(store.getState().onboardingStep, 1);
  browser.win.history.go(1);
  await flush();
  assert.equal(store.getState().onboardingStep, 2);
  store.finishOnboarding();
  store.backTo('splash');
  assert.equal(store.getState().screen, 'splash');
  store.stopNavigation();
});

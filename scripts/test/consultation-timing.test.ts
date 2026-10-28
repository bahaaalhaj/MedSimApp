import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { elapsedConsultationMs, formatConsultationTime, frozenConsultationTiming, finishConsultationTiming } from '../../src/game/consultationTiming.ts';
import { completeEncounter } from '../../src/game/encounterState.ts';
import { buildDebriefRequest } from '../../src/agents/debriefRequest.ts';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8');

test('consultation counts upward in minutes and seconds without an eight-minute cap', () => {
  const timing = { consultationStartedAt: 1000, consultationFinishedAt: null };
  assert.equal(elapsedConsultationMs(timing, 1000), 0);
  assert.equal(formatConsultationTime(elapsedConsultationMs(timing, 126000)), '02:05');
  assert.equal(formatConsultationTime(elapsedConsultationMs(timing, 601000)), '10:00');
  assert.equal(formatConsultationTime(elapsedConsultationMs(timing, 7201000)), '120:00');
});

test('finish freezes the clock once; report viewing and retry do not add time', () => {
  const live = { consultationStartedAt: 1000, consultationFinishedAt: null };
  const finished = finishConsultationTiming(live, 121000);
  assert.equal(finished.consultationFinishedAt, 121000);
  assert.equal(elapsedConsultationMs(finished, 9999999), 120000);
  assert.equal(finishConsultationTiming(finished, 500000).consultationFinishedAt, 121000);
  assert.equal(live.consultationFinishedAt, null);
  assert.deepEqual(frozenConsultationTiming(finished), { startedAtMs: 1000, finishedAtMs: 121000 });
});

test('invalid and historical missing timestamps are unknown, not fabricated durations', () => {
  for (const patient of [{}, { consultationStartedAt: NaN }, { consultationStartedAt: Infinity }]) {
    assert.equal(elapsedConsultationMs(patient, 2000), null);
    assert.equal(frozenConsultationTiming(patient), null);
  }
  assert.equal(frozenConsultationTiming({ consultationStartedAt: 1000 }), null);
  assert.equal(frozenConsultationTiming({ consultationStartedAt: 1000, consultationFinishedAt: 500 }), null);
  assert.equal(elapsedConsultationMs({ consultationStartedAt: 1000 }, 500), 0);
  assert.equal(formatConsultationTime(null), '--:--');
});

test('completion snapshot freezes timing without changing original patient or evidence', () => {
  const patient = { consultationStartedAt: 1000, consultationFinishedAt: null, askedQuestionIds: [], transcript: [],
    examinationActions: [], orderedTestIds: [], givenTreatmentIds: [], submittedDiagnosisId: 'dx' };
  const completed = completeEncounter(patient as never, { sum: true, safe: true, ice: true }, null, 301000)!;
  assert.equal(completed.consultationFinishedAt, 301000);
  assert.equal(completed.submittedDiagnosisId, 'dx');
  assert.equal(patient.consultationFinishedAt, null);
  assert.equal(elapsedConsultationMs(completed, 700000), 300000);
});

test('evaluation request carries only the frozen duration provenance, not time spent reading debrief', () => {
  const patient = { caseVersion: '1', variantSeed: 'seed', investigationAttemptId: 'owner-attempt', examinationActions: [],
    submittedDiagnosisId: 'dx', consultationStartedAt: 1000, consultationFinishedAt: 121000 };
  const request = buildDebriefRequest({ id: 'case' } as never, patient as never, 99999999);
  assert.deepEqual(request.encounter_log.consultation_timing, { startedAtMs: 1000, finishedAtMs: 121000 });
  const legacy = buildDebriefRequest({ id: 'case' } as never, { ...patient, consultationStartedAt: undefined } as never);
  assert.equal(legacy.encounter_log.consultation_timing, undefined);
});

test('start gesture initializes the patient; small count-up clock cleans up its interval', () => {
  const brief = read('src/components/BriefScreen.tsx');
  const store = read('src/game/store.ts');
  const timer = read('src/components/encounter/ConsultationTimer.tsx');
  assert.match(brief, /store\.beginPolyclinicConsultation\(\)/);
  assert.doesNotMatch(brief + store, /8:00|length: 8|deadlineMs|8 \* 60 \* 1000/);
  assert.match(store, /consultationStartedAt: now/);
  assert.match(timer, /role="timer"/);
  assert.match(timer, /aria-live="off"/);
  assert.match(timer, /clearInterval/);
  assert.match(read('src/components/EncounterScreen.tsx'), /<ConsultationTimer/);
});

test('debrief uses frozen timing, labels unscored duration, and never recomputes from Date.now', () => {
  const report = read('src/components/debrief/EvaluationDetails.tsx');
  assert.doesNotMatch(report, /Date\.now\(\)/);
  assert.match(report, /consultation_timing/);
  assert.match(report, /not scored/);
  assert.match(read('src/agents/debriefClient.ts'), /encounterTiming: request\.encounter_log\.consultation_timing/);
});

test('real timer markup counts upward and clears its interval on finish and unmount', () => {
  // Run the actual component with controlled React hooks/clock, render its real
  // JSX using React's server renderer. No browser or extra test library needed.
  const bundle = buildSync({ entryPoints: [resolve(import.meta.dirname, '../../src/components/encounter/ConsultationTimer.tsx')],
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text;
  const require = createRequire(import.meta.url);
  let now = 1000;
  let state: number | undefined;
  let deps: unknown[] = [];
  let cleanup: (() => void) | undefined;
  let interval: (() => void) | undefined;
  let clears = 0;
  const module = { exports: {} as { ConsultationTimer: (props: { timing: object }) => Parameters<typeof renderToStaticMarkup>[0] } };
  runInNewContext(bundle, { module, exports: module.exports, Date: class extends Date { static now() { return now; } },
    window: { setInterval: (callback: () => void) => { interval = callback; return 1; },
      clearInterval: () => { clears++; interval = undefined; } },
    require: (name: string) => name === 'react' ? {
      useState: (initial: () => number) => { state ??= initial(); return [state, (value: number) => { state = value; }]; },
      useEffect: (effect: () => (() => void) | undefined, next: unknown[]) => {
        if (deps.length === next.length && deps.every((value, index) => value === next[index])) return;
        cleanup?.(); cleanup = effect(); deps = next;
      },
    } : require(name),
  });
  const timing = { consultationStartedAt: 1000, consultationFinishedAt: null as number | null };
  const render = () => renderToStaticMarkup(module.exports.ConsultationTimer({ timing }));
  assert.match(render(), /role="timer".*aria-label="Consultation elapsed time \(minutes:seconds\)".*aria-live="off"/);
  assert.match(render(), /00:00/);
  now = 121000; interval!();
  assert.match(render(), /02:00/);
  timing.consultationFinishedAt = now;
  assert.match(render(), /02:00/);
  assert.equal(clears, 1);
  assert.equal(interval, undefined);
  now = 999999;
  assert.match(render(), /02:00/);
  // A new consultation receives a fresh start; unmount disposes its new timer.
  timing.consultationStartedAt = now;
  timing.consultationFinishedAt = null;
  render();
  assert.match(render(), /00:00/);
  cleanup?.();
  assert.equal(clears, 2);
});

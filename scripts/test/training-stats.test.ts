import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTrendSeries,
  calculateStreak,
  calculateTrainingStats,
  selectLastReviews,
  streakMessage,
  type TrainingHistoryEntry,
} from '../../src/profile/trainingStats.ts';

const entry = (overrides: Partial<TrainingHistoryEntry> = {}): TrainingHistoryEntry => ({
  caseId: 'case-a',
  savedAt: new Date(2026, 8, 23, 12).getTime(),
  evaluation: {
    domain_scores: {
      data_gathering: { raw: 0, max: 10 },
      clinical_management: { raw: 0, max: 0 },
      interpersonal: { raw: 10, max: 10 },
    },
  },
  ...overrides,
});

test('training statistics preserve assessed zero and exclude unassessed domains', () => {
  const stats = calculateTrainingStats([entry()]);
  assert.equal(stats.averageScorePercent, 50);
  assert.equal(stats.domains[0].percentage, 0);
  assert.equal(stats.domains[1].percentage, null);
  assert.equal(stats.weakestDomain?.key, 'data_gathering');
});

test('training statistics report sessions, unique cases, and no-assessed state', () => {
  const none = entry({
    caseId: 'case-b',
    evaluation: {
      domain_scores: {
        data_gathering: { raw: 0, max: 0 },
        clinical_management: { raw: 0, max: 0 },
        interpersonal: { raw: 0, max: 0 },
      },
    },
  });
  const stats = calculateTrainingStats([none, { ...none, caseId: 'case-b', savedAt: none.savedAt - 1 }]);
  assert.equal(stats.sessionsCompleted, 2);
  assert.equal(stats.uniqueCasesCompleted, 1);
  assert.equal(stats.averageScorePercent, null);
  assert.equal(stats.weakestDomain, null);
  assert.equal(stats.hasAssessedDomains, false);
});

test('local-date streak exposes completed-today and deterministic copy', () => {
  const now = new Date(2026, 8, 23, 9);
  const today = entry({ savedAt: new Date(2026, 8, 23, 8).getTime() });
  const yesterday = entry({ savedAt: new Date(2026, 8, 22, 8).getTime(), caseId: 'case-b' });
  const active = calculateStreak([today, yesterday], now);
  assert.deepEqual(active, { days: 2, completedToday: true });
  assert.equal(streakMessage(2, active), "You're done for today — come back tomorrow to extend it.");
  const keep = calculateStreak([yesterday], now);
  assert.deepEqual(keep, { days: 1, completedToday: false });
  assert.equal(streakMessage(1, keep), 'Complete one session today to keep your streak.');
  assert.equal(streakMessage(0, keep), 'Complete your first session to start a streak.');
});

test('last reviews and trend series retain gaps and hide entirely unassessed domains', () => {
  const entries = Array.from({ length: 14 }, (_, index) => entry({ savedAt: 1000 - index, caseId: `case-${index}` }));
  assert.equal(selectLastReviews(entries).length, 12);
  const trends = buildTrendSeries([
    entry({
      evaluation: {
        domain_scores: {
          data_gathering: { raw: 0, max: 10 },
          clinical_management: { raw: 0, max: 0 },
          interpersonal: { raw: 0, max: 0 },
        },
      },
    }),
    entry({
      evaluation: {
        domain_scores: {
          data_gathering: { raw: 5, max: 10 },
          clinical_management: { raw: 5, max: 10 },
          interpersonal: { raw: 0, max: 0 },
        },
      },
    }),
  ]);
  assert.deepEqual(trends.find((trend) => trend.key === 'interpersonal')?.points, [null, null]);
  assert.deepEqual(trends.find((trend) => trend.key === 'data_gathering')?.points, [50, 0]);
});

export const TRAINING_DOMAIN_KEYS = ['data_gathering', 'clinical_management', 'interpersonal'] as const;

export type TrainingDomainKey = (typeof TRAINING_DOMAIN_KEYS)[number];

export interface TrainingDomainScore {
  raw: number;
  max: number;
}

export interface TrainingHistoryEntry {
  savedAt: number;
  caseId: string;
  evaluation: {
    domain_scores: Record<TrainingDomainKey, TrainingDomainScore>;
  };
}

export interface DomainSummary {
  key: TrainingDomainKey;
  assessedSamples: number;
  percentage: number | null;
}

export interface StreakSummary {
  days: number;
  completedToday: boolean;
}

export interface TrainingStats {
  sessionsCompleted: number;
  uniqueCasesCompleted: number;
  averageScorePercent: number | null;
  domains: DomainSummary[];
  weakestDomain: DomainSummary | null;
  hasAssessedDomains: boolean;
  streak: StreakSummary;
}

function isAssessed(score: TrainingDomainScore | undefined): score is TrainingDomainScore {
  return Boolean(score && Number.isFinite(score.raw) && Number.isFinite(score.max) && score.max > 0);
}

export function sessionPercentage(entry: TrainingHistoryEntry): number | null {
  let raw = 0;
  let max = 0;
  for (const key of TRAINING_DOMAIN_KEYS) {
    const score = entry.evaluation.domain_scores[key];
    if (!isAssessed(score)) continue;
    raw += score.raw;
    max += score.max;
  }
  return max > 0 ? raw / max : null;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateStreak(entries: TrainingHistoryEntry[], now = new Date()): StreakSummary {
  const completedDates = new Set(entries.map((entry) => localDateKey(new Date(entry.savedAt))));
  const today = localDateKey(now);
  const completedToday = completedDates.has(today);
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!completedToday) cursor.setDate(cursor.getDate() - 1);

  let days = 0;
  while (completedDates.has(localDateKey(cursor))) {
    days += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { days, completedToday };
}

export function calculateTrainingStats(entries: TrainingHistoryEntry[], now = new Date()): TrainingStats {
  const domains = TRAINING_DOMAIN_KEYS.map((key) => {
    const assessed = entries.map((entry) => entry.evaluation.domain_scores[key]).filter(isAssessed);
    return {
      key,
      assessedSamples: assessed.length,
      percentage: assessed.length
        ? Math.round((assessed.reduce((sum, score) => sum + score.raw / score.max, 0) / assessed.length) * 100)
        : null,
    };
  });
  const assessedDomains = domains.filter((domain) => domain.percentage !== null);
  const sessionPercentages = entries.map(sessionPercentage).filter((value): value is number => value !== null);

  return {
    sessionsCompleted: entries.length,
    uniqueCasesCompleted: new Set(entries.map((entry) => entry.caseId)).size,
    averageScorePercent: sessionPercentages.length
      ? Math.round((sessionPercentages.reduce((sum, value) => sum + value, 0) / sessionPercentages.length) * 100)
      : null,
    domains,
    weakestDomain: assessedDomains.reduce<DomainSummary | null>(
      (weakest, domain) => (!weakest || (domain.percentage ?? 0) < (weakest.percentage ?? 0) ? domain : weakest),
      null,
    ),
    hasAssessedDomains: assessedDomains.length > 0,
    streak: calculateStreak(entries, now),
  };
}

export function selectLastReviews<T>(entries: T[], limit = 12): T[] {
  return entries.slice(0, limit);
}

export interface TrendSeries {
  key: TrainingDomainKey;
  points: Array<number | null>;
}

export function buildTrendSeries(entries: TrainingHistoryEntry[], limit = 12): TrendSeries[] {
  const reviews = selectLastReviews(entries, limit).reverse();
  return TRAINING_DOMAIN_KEYS.map((key) => ({
    key,
    points: reviews.map((entry) => {
      const score = entry.evaluation.domain_scores[key];
      return isAssessed(score) ? Math.round((score.raw / score.max) * 100) : null;
    }),
  }));
}

export function streakMessage(sessionCount: number, streak: StreakSummary): string {
  if (sessionCount === 0) return 'Complete your first session to start a streak.';
  if (streak.completedToday) return "You're done for today — come back tomorrow to extend it.";
  if (streak.days > 0) return 'Complete one session today to keep your streak.';
  return 'Complete a session today to start a new streak.';
}

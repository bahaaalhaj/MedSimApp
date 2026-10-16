/** Observed UI duration, not an authoritative clinical score or time limit. */
export interface ConsultationTiming {
  consultationStartedAt?: number | null;
  consultationFinishedAt?: number | null;
}

const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function elapsedConsultationMs(timing: ConsultationTiming, now = Date.now()): number | null {
  if (!validTimestamp(timing.consultationStartedAt)) return null;
  const end = timing.consultationFinishedAt ?? now;
  return validTimestamp(end) ? Math.max(0, end - timing.consultationStartedAt) : null;
}

export function finishConsultationTiming<T extends ConsultationTiming>(timing: T, now = Date.now()): T {
  if (!validTimestamp(timing.consultationStartedAt) || timing.consultationFinishedAt != null || !validTimestamp(now)) return timing;
  return { ...timing, consultationFinishedAt: Math.max(timing.consultationStartedAt, now) };
}

export function frozenConsultationTiming(timing: ConsultationTiming): { startedAtMs: number; finishedAtMs: number } | null {
  const start = timing.consultationStartedAt;
  const finish = timing.consultationFinishedAt;
  return validTimestamp(start) && validTimestamp(finish) && finish >= start
    ? { startedAtMs: start, finishedAtMs: finish }
    : null;
}

export function formatConsultationTime(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return '--:--';
  const seconds = Math.floor(elapsedMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

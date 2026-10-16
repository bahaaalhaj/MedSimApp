import { useEffect, useState } from 'react';
import { elapsedConsultationMs, formatConsultationTime, type ConsultationTiming } from '../../game/consultationTiming';

/** A small non-interactive count-up; no deadline, warning threshold or auto-finish. */
export function ConsultationTimer({ timing }: { timing: ConsultationTiming }) {
  const [now, setNow] = useState(Date.now);
  const start = timing.consultationStartedAt;
  const finish = timing.consultationFinishedAt;
  useEffect(() => {
    if (start == null || finish != null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [start, finish]);

  return (
    <div role="timer" aria-label="Consultation elapsed time (minutes:seconds)" aria-live="off"
      style={{ position: 'fixed', top: 78, left: 12, zIndex: 'var(--layer-dialogue)',
        pointerEvents: 'none', background: 'var(--cream)', color: 'var(--ink)',
        border: '2px solid var(--line)', borderRadius: 12, boxShadow: 'var(--plush-tiny)',
        padding: '7px 10px', fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
      Elapsed · {formatConsultationTime(elapsedConsultationMs(timing, now))}
    </div>
  );
}

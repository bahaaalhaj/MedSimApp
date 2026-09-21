import type { DomainScore, VerdictBand } from '../../agents/evaluationSchema';

const RING_COLOR: Record<VerdictBand, string> = {
  excellent: 'var(--mint-deep)',
  good: 'var(--mint-deep)',
  satisfactory: 'var(--butter-deep)',
  borderline: 'var(--peach-deep)',
  'clear-fail': 'var(--rose-deep)',
};

const formatScore = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Pure debrief score presentation; evaluation is computed before this component receives it. */
export function DomainRing({ label, score }: { label: string; score: DomainScore }) {
  const percentage = score.max > 0 ? score.raw / score.max : 0;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const qualitative = score.verdict === 'excellent' || score.verdict === 'good' ? 'on target' : score.verdict === 'satisfactory' ? 'fair' : 'work needed';
  return <div style={{ background: 'white', border: '3px solid var(--line)', borderRadius: 16, padding: 14, boxShadow: 'var(--plush-tiny)', display: 'flex', alignItems: 'center', gap: 14 }}>
    <svg width="84" height="84" viewBox="0 0 84 84">
      <circle cx="42" cy="42" r={radius} fill="none" stroke="var(--cream)" strokeWidth="10" />
      <circle cx="42" cy="42" r={radius} fill="none" stroke={RING_COLOR[score.verdict]} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${circumference * percentage} ${circumference}`} transform="rotate(-90 42 42)" />
      <text x="42" y="48" textAnchor="middle" fontFamily="Nunito" fontWeight="900" fontSize="16" fill="var(--ink)">{formatScore(score.raw)}/{score.max}</text>
    </svg>
    <div><div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.1 }}>{label}</div><div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)', marginTop: 2 }}>{qualitative}</div></div>
  </div>;
}

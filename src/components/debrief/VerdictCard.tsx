import { Doodle } from '../primitives';

type VerdictBand = 'excellent' | 'good' | 'satisfactory' | 'borderline' | 'clear-fail';

type Props = {
  verdict: VerdictBand;
  narrative: string;
};

const GLOBAL_HEADLINE: Record<VerdictBand, string> = {
  excellent: 'Excellent — top tier',
  good: 'Good — solid case',
  satisfactory: 'Satisfactory — good effort',
  borderline: 'Borderline — worth re-running',
  'clear-fail': 'Clear fail — let’s restart',
};

const GLOBAL_BG: Record<VerdictBand, string> = {
  excellent: 'var(--mint)',
  good: 'var(--mint)',
  satisfactory: 'var(--butter)',
  borderline: 'var(--peach)',
  'clear-fail': 'var(--rose)',
};

const GLOBAL_DEEP: Record<VerdictBand, string> = {
  excellent: 'var(--mint-deep)',
  good: 'var(--mint-deep)',
  satisfactory: 'var(--butter-deep)',
  borderline: 'var(--peach-deep)',
  'clear-fail': 'var(--rose-deep)',
};

export function VerdictCard({ verdict, narrative }: Props) {
  return (
    <div
      className="plush-lg popin"
      style={{
        background: GLOBAL_BG[verdict],
        padding: 24,
        position: 'relative',
        marginBottom: 22,
        transform: 'rotate(-0.4deg)',
      }}
    >
      <div style={{ position: 'absolute', top: -14, left: 24 }} className="chip butter">
        YOUR MARK
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <div className="floaty">
          <div
            className="plush"
            style={{
              width: 110,
              height: 110,
              background: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Doodle kind="star" size={86} color="#FFD86B" />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: 'var(--ink-2)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
            }}
          >
            VERDICT
          </div>
          <h1 style={{ fontSize: 38, lineHeight: 1.05, margin: '4px 0 8px' }}>
            {GLOBAL_HEADLINE[verdict].split(' — ')[0]}{' '}
            <span style={{ fontSize: 22, color: GLOBAL_DEEP[verdict] }}>
              {' · ' + (GLOBAL_HEADLINE[verdict].split(' — ')[1] ?? '')}
            </span>
          </h1>
          <div style={{ fontSize: 15, lineHeight: 1.55, fontWeight: 600, color: 'var(--ink)' }}>
            {narrative}
          </div>
        </div>
      </div>
    </div>
  );
}

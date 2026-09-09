import { useEffect, useMemo, useState } from 'react';
import { TopBar } from './primitives';
import { store } from '../game/store';
import { listEvalHistory, type EvalHistoryEntry } from '../data/evalHistory';
import { useAuth } from '../auth/AuthProvider';

const VERDICT_COLOR: Record<EvalHistoryEntry['verdict'], string> = {
  excellent: 'var(--mint)', good: 'var(--mint)', satisfactory: 'var(--butter)',
  borderline: 'var(--peach)', 'clear-fail': 'var(--rose)',
};

function TrendChart({ history }: { history: EvalHistoryEntry[] }) {
  const ordered = history.slice(0, 12).reverse();
  const points = (key: 'data_gathering' | 'clinical_management' | 'interpersonal') =>
    ordered.map((entry) => {
      const score = entry.evaluation.domain_scores[key];
      return score.max > 0 ? Math.round((score.raw / score.max) * 100) : 0;
    });
  const series = [
    { color: 'var(--peach-deep)', pts: points('data_gathering') },
    { color: 'var(--mint-deep)', pts: points('clinical_management') },
    { color: 'var(--sky-deep)', pts: points('interpersonal') },
  ];
  const W = 980;
  const H = 180;
  const P = 16;
  const x = (i: number) => P + (i / Math.max(1, ordered.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / 100) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }}>
      {[0, 25, 50, 75, 100].map((g, i) => (
        <g key={i}>
          <line
            x1={P}
            y1={y(g)}
            x2={W - P}
            y2={y(g)}
            stroke="rgba(43,30,22,0.08)"
            strokeWidth="1.5"
            strokeDasharray="3 5"
          />
          <text x={4} y={y(g) + 4} fontSize="9" fontFamily="Nunito" fontWeight="800" fill="var(--ink-2)">
            {g}
          </text>
        </g>
      ))}
      {series.map((s, si) => (
        <g key={si}>
          <path
            d={s.pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {s.pts.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="white" stroke={s.color} strokeWidth="2.5" />
          ))}
        </g>
      ))}
    </svg>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: color, border: '2px solid var(--line)' }} />
      {label}
    </span>
  );
}

export function HistoryScreen() {
  const auth = useAuth();
  const [history, setHistory] = useState<EvalHistoryEntry[]>([]);
  useEffect(() => {
    let active = true;
    void listEvalHistory().then((entries) => { if (active) setHistory(entries); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const weakest = useMemo(() => {
    if (!history.length) return null;
    const domains = [
      ['Data Gathering', 'data_gathering'], ['Clinical Management', 'clinical_management'], ['Interpersonal', 'interpersonal'],
    ] as const;
    return domains.map(([label, key]) => ({
      label,
      score: history.reduce((sum, entry) => {
        const value = entry.evaluation.domain_scores[key];
        return sum + (value.max > 0 ? value.raw / value.max : 0);
      }, 0) / history.length,
    })).sort((a, b) => a.score - b.score)[0];
  }, [history]);
  return (
    <div className="screen" style={{ background: 'var(--cream)', overflowY: 'auto' }}>
      <TopBar here={1} steps={['Profile', 'History']} />
      <div style={{ padding: '28px 36px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div>
            <h1 style={{ fontSize: 36 }}>Your training log</h1>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>
              The story is the trend, not any single case.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="chip butter">last 30 days</span>
            <span className="chip">all conditions ▾</span>
            <button
              type="button"
              className="btn-plush ghost"
              style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => store.setScreen('home')}
            >
              ← Profile
            </button>
          </div>
        </div>

        <div className="plush" style={{ padding: 16, marginBottom: 18, background: 'white' }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 11,
              color: 'var(--ink-2)',
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            DOMAIN TRENDS · last 30 days
          </div>
          {history.length ? <TrendChart history={history} /> : <div style={{ padding: 34, textAlign: 'center', fontWeight: 700, color: 'var(--ink-2)' }}>Your trend appears after the first completed debrief.</div>}
          <div
            style={{
              display: 'flex',
              gap: 14,
              marginTop: 12,
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <Legend color="var(--peach-deep)" label="Data Gathering" />
            <Legend color="var(--mint-deep)" label="Clinical Management" />
            <Legend color="var(--sky-deep)" label="Interpersonal" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
          <div className="plush" style={{ padding: 16 }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: 11,
                color: 'var(--ink-2)',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              CASE TIMELINE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.map((c, i) => (
                <div
                  key={c.id}
                  className="tap"
                  onClick={() => store.viewEvalHistory(c.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 28px 1fr 110px 30px',
                    gap: 10,
                    alignItems: 'center',
                    padding: '8px 8px',
                    borderBottom: i < history.length - 1 ? '2px dashed rgba(43,30,22,0.15)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-2)' }}>{new Date(c.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: VERDICT_COLOR[c.verdict],
                      border: '2.5px solid var(--line)',
                      boxShadow: '0 2px 0 var(--line)',
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{c.caseName}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>{c.diagnosisLabel}</div>
                  </div>
                  <span className="chip" style={{ background: VERDICT_COLOR[c.verdict], fontSize: 11 }}>
                    {c.verdict.replace('-', ' ')}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink-2)' }}>›</span>
                </div>
              ))}
              {!history.length && <div style={{ padding: 24, textAlign: 'center', fontWeight: 700, color: 'var(--ink-2)' }}>No completed reviews for this {auth.status === 'guest' ? 'guest session' : 'account'} yet.</div>}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="plush" style={{ padding: 16, background: 'var(--peach)' }}>
              <div className="chip" style={{ background: 'white', marginBottom: 10 }}>
                🎯 FOCUS AREA
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>{weakest?.label ?? 'Your first case'}</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                {weakest ? `This is currently your lowest average domain at ${Math.round(weakest.score * 100)}%.` : 'Complete a debrief to receive a personal focus area.'}
              </div>
            </div>

            <div className="plush" style={{ padding: 16 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 11,
                  color: 'var(--ink-2)',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}
              >
                PRIVATE PROGRESS
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>{auth.status === 'guest' ? 'Stored only for this guest identity on this device.' : 'Loaded only from your authenticated account.'}</div>
            </div>

            <div className="plush" style={{ padding: 16, background: 'var(--rose)' }}>
              <div className="chip" style={{ background: 'white', marginBottom: 10 }}>
                COMPLETED REVIEWS
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, lineHeight: 1 }}>{history.length}</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>owned by this identity</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

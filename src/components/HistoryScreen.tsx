import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopBar } from './primitives';
import { store } from '../game/store';
import { listEvalHistory, type EvalHistoryEntry } from '../data/evalHistory';
import { useAuth } from '../auth/AuthProvider';
import {
  buildTrendSeries,
  calculateTrainingStats,
  selectLastReviews,
  type TrainingDomainKey,
} from '../profile/trainingStats';

const COLORS: Record<TrainingDomainKey, string> = {
  data_gathering: 'var(--peach-deep)',
  clinical_management: 'var(--mint-deep)',
  interpersonal: 'var(--sky-deep)',
};
const LABELS: Record<TrainingDomainKey, string> = {
  data_gathering: 'Data Gathering',
  clinical_management: 'Clinical Management',
  interpersonal: 'Interpersonal',
};
const VERDICT_COLOR: Record<EvalHistoryEntry['verdict'], string> = {
  excellent: 'var(--mint)',
  good: 'var(--mint)',
  satisfactory: 'var(--butter)',
  borderline: 'var(--peach)',
  'clear-fail': 'var(--rose)',
};

function pathFor(points: Array<number | null>, x: (i: number) => number, y: (v: number) => number) {
  let drawing = false;
  return points
    .map((value, index) => {
      if (value === null) {
        drawing = false;
        return '';
      }
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command} ${x(index)} ${y(value)}`;
    })
    .filter(Boolean)
    .join(' ');
}

function TrendChart({ history }: { history: EvalHistoryEntry[] }) {
  const series = buildTrendSeries(history);
  const visible = series.filter((item) => item.points.some((point) => point !== null));
  const count = series[0]?.points.length ?? 0;
  const W = 980;
  const H = 180;
  const P = 16;
  const x = (i: number) => P + (i / Math.max(1, count - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / 100) * (H - 2 * P);
  if (!visible.length)
    return (
      <div style={{ padding: 34, textAlign: 'center', fontWeight: 700, color: 'var(--ink-2)' }}>
        Not enough assessed data
      </div>
    );
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 180 }}
        aria-label="Domain trends for the last 12 reviews"
      >
        {[0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line
              x1={P}
              y1={y(value)}
              x2={W - P}
              y2={y(value)}
              stroke="rgba(43,30,22,0.08)"
              strokeWidth="1.5"
              strokeDasharray="3 5"
            />
            <text x={4} y={y(value) + 4} fontSize="9" fontFamily="Nunito" fontWeight="800" fill="var(--ink-2)">
              {value}
            </text>
          </g>
        ))}
        {visible.map((item) => (
          <g key={item.key}>
            <path
              d={pathFor(item.points, x, y)}
              fill="none"
              stroke={COLORS[item.key]}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {item.points.map((value, index) =>
              value === null ? null : (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(value)}
                  r="4"
                  fill="white"
                  stroke={COLORS[item.key]}
                  strokeWidth="2.5"
                />
              ),
            )}
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 12, justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
        {visible.map((item) => (
          <span key={item.key} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                background: COLORS[item.key],
                border: '2px solid var(--line)',
              }}
            />
            {LABELS[item.key]}
          </span>
        ))}
      </div>
    </>
  );
}

export function HistoryScreen() {
  const auth = useAuth();
  const [history, setHistory] = useState<EvalHistoryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      setHistory(await listEvalHistory());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const lastTwelve = useMemo(() => selectLastReviews(history), [history]);
  const stats = useMemo(() => calculateTrainingStats(history), [history]);
  const weakest = stats.weakestDomain ? LABELS[stats.weakestDomain.key] : null;
  return (
    <div className="screen" style={{ background: 'var(--cream)', overflowY: 'auto' }}>
      <TopBar here={1} steps={['Profile', 'History']} />
      <main style={{ padding: '28px 36px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 36 }}>Your training log</h1>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>
              The story is the trend, not any single case.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="chip butter">Last 12 reviews</span>
            <button
              type="button"
              className="btn-plush ghost"
              style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => store.setScreen('home')}
            >
              ← Profile
            </button>
          </div>
        </header>
        {status === 'loading' && !history.length ? (
          <div className="plush" role="status" style={{ padding: 24, fontWeight: 700 }}>
            Loading your training history…
          </div>
        ) : status === 'error' && !history.length ? (
          <div className="plush" role="alert" style={{ padding: 24 }}>
            <strong>Your training history could not be loaded.</strong>
            <br />
            <button type="button" className="btn-plush ghost" style={{ marginTop: 12 }} onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {status === 'error' && (
              <div role="alert" className="plush" style={{ padding: 12, marginBottom: 18 }}>
                Could not refresh history.{' '}
                <button type="button" className="btn-plush ghost" onClick={() => void refresh()}>
                  Retry
                </button>
              </div>
            )}
            <section className="plush" style={{ padding: 16, marginBottom: 18, background: 'white' }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 11,
                  color: 'var(--ink-2)',
                  letterSpacing: '.06em',
                  marginBottom: 12,
                }}
              >
                DOMAIN TRENDS · LAST 12 REVIEWS
              </div>
              {history.length ? (
                <TrendChart history={lastTwelve} />
              ) : (
                <div style={{ padding: 34, textAlign: 'center', fontWeight: 700, color: 'var(--ink-2)' }}>
                  Your trend appears after the first completed debrief.
                </div>
              )}
            </section>
            <div
              className="history-grid"
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(260px, 1fr)', gap: 18 }}
            >
              <section className="plush" style={{ padding: 16 }}>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 11,
                    color: 'var(--ink-2)',
                    letterSpacing: '.06em',
                    marginBottom: 12,
                  }}
                >
                  CASE TIMELINE
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {history.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="tap history-row"
                      aria-label={`Review ${entry.caseName}`}
                      onClick={() => store.viewEvalHistory(entry.id)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 28px minmax(0, 1fr) 110px 30px',
                        gap: 10,
                        alignItems: 'center',
                        padding: '8px',
                        border: 0,
                        borderBottom: index < history.length - 1 ? '2px dashed rgba(43,30,22,0.15)' : 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        color: 'inherit',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink-2)' }}>
                        {new Date(entry.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: VERDICT_COLOR[entry.verdict],
                          border: '2.5px solid var(--line)',
                        }}
                      />
                      <span>
                        <strong>{entry.caseName}</strong>
                        <br />
                        <small style={{ fontWeight: 700, color: 'var(--ink-2)' }}>{entry.diagnosisLabel}</small>
                      </span>
                      <span className="chip" style={{ background: VERDICT_COLOR[entry.verdict], fontSize: 11 }}>
                        {entry.verdict.replace('-', ' ')}
                      </span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--ink-2)' }}>›</span>
                    </button>
                  ))}
                  {!history.length && (
                    <div style={{ padding: 24, textAlign: 'center', fontWeight: 700, color: 'var(--ink-2)' }}>
                      No completed reviews for this {auth.status === 'guest' ? 'guest session' : 'account'} yet.
                    </div>
                  )}
                </div>
              </section>
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <section className="plush" style={{ padding: 16, background: 'var(--peach)' }}>
                  <div className="chip" style={{ background: 'white', marginBottom: 10 }}>
                    🎯 FOCUS AREA
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{weakest ?? 'Not enough assessed data'}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                    {stats.weakestDomain
                      ? `This is currently your lowest assessed domain at ${stats.weakestDomain.percentage}%.`
                      : 'Complete a debrief with assessed domains to receive a focus area.'}
                  </div>
                </section>
                <section className="plush" style={{ padding: 16 }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 11,
                      color: 'var(--ink-2)',
                      letterSpacing: '.06em',
                      marginBottom: 10,
                    }}
                  >
                    PRIVATE PROGRESS
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
                    {auth.status === 'guest'
                      ? 'Stored only for this guest identity on this device.'
                      : 'Loaded only from your authenticated account.'}
                  </div>
                </section>
                <section className="plush" style={{ padding: 16, background: 'var(--rose)' }}>
                  <div className="chip" style={{ background: 'white', marginBottom: 10 }}>
                    COMPLETED REVIEWS
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 900 }}>{stats.sessionsCompleted}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>owned by this identity</div>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

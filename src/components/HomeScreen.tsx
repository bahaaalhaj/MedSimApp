import { useCallback, useEffect, useState } from 'react';
import { PatientFace, TopBar } from './primitives';
import { store, useTweaks } from '../game/store';
import { useAuth } from '../auth/AuthProvider';
import { deleteEvalHistory, listEvalHistory, type EvalHistoryEntry } from '../data/evalHistory';
import { calculateTrainingStats, streakMessage, type TrainingDomainKey } from '../profile/trainingStats';

const VERDICT_COLOR: Record<EvalHistoryEntry['verdict'], string> = {
  excellent: 'var(--mint)',
  good: 'var(--mint)',
  satisfactory: 'var(--butter)',
  borderline: 'var(--peach)',
  'clear-fail': 'var(--rose)',
};
const VERDICT_LABEL: Record<EvalHistoryEntry['verdict'], string> = {
  excellent: 'Excellent',
  good: 'Good',
  satisfactory: 'Satisfactory',
  borderline: 'Borderline',
  'clear-fail': 'Clear fail',
};
const DOMAINS: Array<{ key: TrainingDomainKey; label: string; color: string; deep: string }> = [
  { key: 'data_gathering', label: 'Data Gathering', color: 'var(--peach)', deep: 'var(--peach-deep)' },
  { key: 'clinical_management', label: 'Clinical Management', color: 'var(--mint)', deep: 'var(--mint-deep)' },
  { key: 'interpersonal', label: 'Interpersonal', color: 'var(--sky)', deep: 'var(--sky-deep)' },
];

function relativeDate(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Stat({ big, sub }: { big: string; sub: string }) {
  return (
    <div
      style={{
        background: 'white',
        border: '3px solid var(--line)',
        borderRadius: 14,
        padding: 12,
        boxShadow: 'var(--plush-tiny)',
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 32, lineHeight: 1 }}>{big}</div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--ink-2)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          marginTop: 4,
        }}
      >
        {sub}
      </div>
    </div>
  );
}

export function HomeScreen() {
  const tweaks = useTweaks();
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
  const remove = async (id: string) => {
    try {
      await deleteEvalHistory(id);
      await refresh();
    } catch {
      /* Preserve data when deletion is unconfirmed. */
    }
  };
  const stats = calculateTrainingStats(history);
  const weakestMeta = stats.weakestDomain
    ? DOMAINS.find((domain) => domain.key === stats.weakestDomain?.key)
    : undefined;
  const identity = auth.status === 'guest' ? 'Guest' : (auth.user?.displayName ?? 'doctor');

  return (
    <div className="screen" style={{ background: 'var(--cream)', overflowY: 'auto' }}>
      <TopBar here={0} steps={['Profile']} />
      <main
        className="profile-grid"
        style={{
          padding: '28px 36px',
          minHeight: 'calc(100vh - 67px)',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)',
          gap: 24,
        }}
      >
        <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <header>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink-2)' }}>
              {stats.sessionsCompleted ? 'Welcome back' : 'Day one'}
            </div>
            <h1 style={{ fontSize: 44, lineHeight: 1.05, marginTop: 4 }}>
              {stats.sessionsCompleted ? `Welcome back, ${identity}.` : `Ready when you are, ${identity}.`}
            </h1>
            <div style={{ fontSize: 16, color: 'var(--ink-2)', fontWeight: 600, marginTop: 6 }}>
              {stats.sessionsCompleted
                ? 'Your training log is updating with every case you finish.'
                : 'Pick a polyclinic and your first case walks in. Your training log starts filling in after that.'}
            </div>
          </header>
          {status === 'loading' && !history.length ? (
            <div className="plush" role="status" style={{ padding: 18, fontWeight: 700, color: 'var(--ink-2)' }}>
              Loading your training history…
            </div>
          ) : status === 'error' && !history.length ? (
            <div className="plush" role="alert" style={{ padding: 18 }}>
              <strong>Your training history could not be loaded.</strong>
              <br />
              <button
                type="button"
                className="btn-plush ghost"
                style={{ marginTop: 12 }}
                onClick={() => void refresh()}
              >
                Retry
              </button>
            </div>
          ) : history.length ? (
            <div className="plush-lg" style={{ background: 'var(--peach)', padding: 18 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  alignItems: 'center',
                  background: 'white',
                  borderRadius: 18,
                  border: '3px solid var(--line)',
                  padding: 16,
                }}
              >
                <PatientFace
                  style={tweaks.avatarStyle}
                  skin={history[0].caseGender === 'F' ? '#F0C4A8' : '#E8B68F'}
                  hair="#3B2A1F"
                  size={100}
                  mood="neutral"
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 900, fontSize: 22 }}>
                    {history[0].caseName}, {history[0].caseAge}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-2)' }}>
                    {history[0].diagnosisLabel}
                  </div>
                  <span className="chip" style={{ background: VERDICT_COLOR[history[0].verdict], marginTop: 10 }}>
                    {VERDICT_LABEL[history[0].verdict]}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-plush primary"
                  aria-label={`Review ${history[0].caseName}`}
                  onClick={() => store.viewEvalHistory(history[0].id)}
                >
                  Review →
                </button>
              </div>
            </div>
          ) : (
            <div className="plush-lg" style={{ background: 'var(--cream-2)', padding: 18 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  alignItems: 'center',
                  background: 'white',
                  borderRadius: 18,
                  border: '3px dashed rgba(43,30,22,0.25)',
                  padding: 16,
                }}
              >
                <PatientFace style={tweaks.avatarStyle} skin="#E8B68F" hair="#3B2A1F" size={100} mood="neutral" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 900, fontSize: 22 }}>No case picked yet</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-2)' }}>
                    Choose a polyclinic — the next patient on the bench will walk straight in.
                  </div>
                </div>
                <button type="button" className="btn-plush primary" onClick={() => store.setScreen('gpRoom')}>
                  Start →
                </button>
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn-plush mint"
            style={{ fontSize: 22, padding: '18px 0' }}
            onClick={() => store.setScreen('gpRoom')}
          >
            ▶ Start a session
          </button>
          <section className="plush" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--ink-2)', letterSpacing: '.06em' }}>
                RECENT CASES
              </div>
              <button
                type="button"
                className="btn-plush ghost"
                aria-label="See all training history"
                style={{ fontSize: 12, padding: '5px 10px' }}
                onClick={() => store.setScreen('history')}
              >
                See all →
              </button>
            </div>
            {status === 'error' && history.length > 0 && (
              <div role="alert" style={{ marginBottom: 10, fontWeight: 700 }}>
                Could not refresh history.{' '}
                <button type="button" className="btn-plush ghost" onClick={() => void refresh()}>
                  Retry
                </button>
              </div>
            )}
            {history.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.slice(0, 6).map((entry) => (
                  <div
                    key={entry.id}
                    className="profile-recent-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--cream)',
                      border: '2.5px solid var(--line)',
                      borderRadius: 12,
                    }}
                  >
                    <button
                      type="button"
                      className="tap"
                      aria-label={`Review ${entry.caseName}`}
                      onClick={() => store.viewEvalHistory(entry.id)}
                      style={{
                        textAlign: 'left',
                        background: 'transparent',
                        border: 0,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        color: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {entry.caseName}{' '}
                        <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>
                          · {entry.caseAge}
                          {entry.caseGender}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 700 }}>
                        {entry.diagnosisLabel} · {VERDICT_LABEL[entry.verdict]} · {relativeDate(entry.savedAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete review for ${entry.caseName}`}
                      title="Delete this review"
                      onClick={() => {
                        if (window.confirm(`Delete review for ${entry.caseName}?`)) void remove(entry.id);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        fontSize: 16,
                        fontWeight: 800,
                        color: 'var(--ink-2)',
                        cursor: 'pointer',
                        padding: 4,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', textAlign: 'center' }}>
                No reviews yet — finish an encounter to see your feedback here.
              </div>
            )}
          </section>
        </section>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="plush" style={{ padding: 16, background: 'var(--butter)' }}>
            <div
              style={{ fontWeight: 800, fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.06em', marginBottom: 10 }}
            >
              YOUR TRAINING
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Stat big={stats.sessionsCompleted ? String(stats.sessionsCompleted) : '—'} sub="sessions completed" />
              <Stat
                big={stats.averageScorePercent === null ? '—' : `${stats.averageScorePercent}%`}
                sub="average score"
              />
            </div>
          </section>
          <section className="plush" style={{ padding: 16 }}>
            <div
              style={{ fontWeight: 800, fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.06em', marginBottom: 10 }}
            >
              WEAKEST DOMAIN
            </div>
            {weakestMeta && stats.weakestDomain ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{weakestMeta.label}</div>
                <div
                  style={{ marginTop: 8, height: 12, background: 'var(--cream)', borderRadius: 8, overflow: 'hidden' }}
                >
                  <div
                    style={{
                      width: `${stats.weakestDomain.percentage}%`,
                      height: '100%',
                      background: weakestMeta.deep,
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>
                  {stats.weakestDomain.percentage}% · focus area
                </div>
              </>
            ) : (
              <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>Not enough assessed data</div>
            )}
          </section>
          <section className="plush" style={{ padding: 16 }}>
            <div
              style={{ fontWeight: 800, fontSize: 11, color: 'var(--ink-2)', letterSpacing: '.06em', marginBottom: 10 }}
            >
              DOMAIN PROGRESS
            </div>
            {stats.hasAssessedDomains ? (
              DOMAINS.map((domain) => {
                const summary = stats.domains.find((item) => item.key === domain.key)!;
                return (
                  <div key={domain.key} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 12,
                        fontWeight: 800,
                        marginBottom: 4,
                      }}
                    >
                      <span>{domain.label}</span>
                      <span>{summary.percentage === null ? 'Not assessed' : `${summary.percentage}%`}</span>
                    </div>
                    <div style={{ height: 14, background: 'var(--cream)', borderRadius: 8, overflow: 'hidden' }}>
                      {summary.percentage !== null && (
                        <div style={{ width: `${summary.percentage}%`, height: '100%', background: domain.color }} />
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>Not enough assessed data</div>
            )}
          </section>
          <section
            className="plush"
            style={{ padding: 14, background: 'var(--mint)', display: 'flex', gap: 12, alignItems: 'center' }}
          >
            <div style={{ fontSize: 32 }}>📚</div>
            <div>
              <div style={{ fontWeight: 900 }}>
                {stats.streak.days
                  ? `Streak: ${stats.streak.days} ${stats.streak.days === 1 ? 'day' : 'days'}`
                  : 'Streak: —'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>
                {streakMessage(stats.sessionsCompleted, stats.streak)}
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

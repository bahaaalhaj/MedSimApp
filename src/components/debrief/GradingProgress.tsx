import { useEffect, useState } from 'react';
import { AttendingCardFrame } from './AttendingCardFrame';
import { StatusBanner } from './StatusBanner';

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '\u2026';
}

const GRADING_STEPS = [
  'Replaying your conversation with the patient',
  'Auditing the questions you asked during history-taking',
  'Cross-checking the differential against the chief complaint',
  'Reviewing the tests you ordered for relevance and coverage',
  'Inspecting your prescriptions against the diagnosis',
  'Comparing your management plan to clinical guidelines',
  'Scoring data gathering, clinical management & interpersonal',
  'Drafting personalised feedback for each criterion',
];

export function GradingProgress({ partialNarration }: { partialNarration: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (partialNarration.length > 0) return; // stop ticking once narration arrives
    const id = window.setInterval(() => {
      setStep((s) => Math.min(s + 1, GRADING_STEPS.length - 1));
    }, 1400);
    return () => window.clearInterval(id);
  }, [partialNarration.length > 0]);

  // Once narration arrives, dump it into the banner instead of the steps.
  if (partialNarration.length > 0) {
    return (
      <StatusBanner
        title={'The attending is grading\u2026'}
        body={truncate(partialNarration, 320)}
        bg="var(--sky)"
      />
    );
  }

  return (
    <AttendingCardFrame label="ATTENDING" background="var(--sky)">
      <h1 style={{ fontSize: 32, lineHeight: 1.05, margin: '4px 0 12px' }}>
        The attending is grading{'\u2026'}
      </h1>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {GRADING_STEPS.map((label, i) => {
              const state = i < step ? 'done' : i === step ? 'active' : 'pending';
              const icon =
                state === 'done' ? (
                  '✓'
                ) : state === 'active' ? (
                  <span
                    aria-label="loading"
                    style={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      border: '2px solid rgba(43,30,22,0.25)',
                      borderTopColor: 'var(--ink)',
                      animation: 'gr-spin 0.7s linear infinite',
                    }}
                  />
                ) : (
                  '○'
                );
              const opacity = state === 'pending' ? 0.4 : 1;
              const fontWeight = state === 'active' ? 800 : 700;
              const bg = state === 'done' ? 'rgba(255,255,255,0.55)' : state === 'active' ? 'white' : 'transparent';
              return (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 14,
                    fontWeight,
                    color: 'var(--ink)',
                    opacity,
                    background: bg,
                    border: state === 'pending' ? '2px dashed rgba(43,30,22,0.18)' : '2.5px solid var(--line)',
                    borderRadius: 10,
                    padding: '6px 10px',
                    transition: 'opacity 0.3s, background 0.3s',
                  }}
                >
                  <span
                    className={state === 'active' ? 'breathe' : ''}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: state === 'done' ? 'var(--mint)' : state === 'active' ? 'var(--butter)' : 'var(--cream)',
                      border: '2px solid var(--line)',
                      fontSize: 13,
                      fontWeight: 900,
                    }}
                  >
                    {icon}
                  </span>
                  <span>{label}</span>
                </li>
              );
            })}
      </ul>
    </AttendingCardFrame>
  );
}

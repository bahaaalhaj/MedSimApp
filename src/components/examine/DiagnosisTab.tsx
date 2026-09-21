import { useMemo } from 'react';

type DiagnosisResult = {
  correctDiagnosisId: string;
  diagnosisWasCorrect: boolean;
};

type Props = {
  caseId: string;
  diagnosisOptions: readonly string[];
  diagnosisResult?: DiagnosisResult;
  diagnosisLabel: (diagnosisId: string) => string;
  submitted: string | null;
  onSubmitDiagnosis: (diagnosisId: string) => void;
  onFinish: () => void;
  onGoToRx: () => void;
};

// shuffled diagnosis tiles don't reshuffle if the overlay is reopened.
function shuffleSeeded<T>(input: readonly T[], seedKey: string): T[] {
  let seed = 2166136261 >>> 0;
  for (let i = 0; i < seedKey.length; i++) {
    seed ^= seedKey.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const rand = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function DiagnosisTab({
  caseId,
  diagnosisOptions,
  diagnosisResult,
  diagnosisLabel,
  onFinish,
  onGoToRx,
  onSubmitDiagnosis,
  submitted,
}: Props) {
  // Shuffle deterministically per case so tiles cannot be gamed by position
  // and their order stays stable if the overlay is closed and reopened.
  const shuffledOptions = useMemo(
    () => shuffleSeeded(diagnosisOptions, caseId),
    [caseId, diagnosisOptions],
  );
  if (diagnosisOptions.length === 0) {
    return (
      <div className="plush" style={{ padding: 14, fontWeight: 700, color: 'var(--ink-2)' }}>
        No diagnosis options for this case.
      </div>
    );
  }
  const result = diagnosisResult;
  const isCorrect = result?.diagnosisWasCorrect ?? false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--ink-2)' }}>
        Pick the most likely diagnosis based on what you've gathered so far.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {shuffledOptions.map((dxId) => {
          const isPicked = submitted === dxId;
          const showCorrect = result !== undefined && dxId === result.correctDiagnosisId;
          const showWrong = result !== undefined && isPicked && !isCorrect;
          const bg = showCorrect ? 'var(--mint)' : showWrong ? 'var(--rose)' : isPicked ? 'var(--butter)' : 'white';
          return (
            <button
              key={dxId}
              type="button"
              className="tap btn-plush ghost"
              disabled={submitted !== null}
              onClick={() => onSubmitDiagnosis(dxId)}
              style={{
                fontSize: 13,
                padding: '12px 14px',
                background: bg,
                fontWeight: 800,
                cursor: submitted !== null ? 'default' : 'pointer',
              }}
            >
              {showCorrect ? '✓ ' : showWrong ? '✗ ' : ''}
              {diagnosisLabel(dxId)}
            </button>
          );
        })}
      </div>

      {result && (
        <div
          className="plush"
          style={{
            padding: 14,
            background: isCorrect ? 'var(--mint)' : 'var(--rose)',
            fontWeight: 800,
          }}
        >
          {isCorrect
            ? `✓ Spot on — ${diagnosisLabel(result.correctDiagnosisId)}.`
            : `✗ Not quite. The correct diagnosis was ${diagnosisLabel(result.correctDiagnosisId)}.`}
        </div>
      )}

      {submitted && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button
            type="button"
            className="btn-plush primary breathe"
            style={{ fontSize: 16, padding: '14px 0' }}
            onClick={onGoToRx}
          >
            Write prescription →
          </button>
          <button
            type="button"
            className="btn-plush ghost"
            style={{ fontSize: 16, padding: '14px 0' }}
            onClick={onFinish}
          >
            Finish without prescription →
          </button>
        </div>
      )}
    </div>
  );
}

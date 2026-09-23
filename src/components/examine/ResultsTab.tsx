import { useEffect, useState } from 'react';
import { investigationResultText } from '../../clinical/investigations';
import { testById } from '../../data/tests';
import type { ActivePatient } from '../../game/types';

type ResultsPatient = Pick<ActivePatient, 'completedTestIds' | 'investigationOrders' | 'orderedTestIds'>;

type Props = {
  patient: ResultsPatient;
};

export function ResultsTab({ patient }: Props) {
  const completed = new Set(patient.completedTestIds);
  const [zoomed, setZoomed] = useState<{ url: string; caption: string; credit: string } | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomed]);

  if (patient.orderedTestIds.length === 0) {
    return (
      <div className="plush" style={{ padding: 14, fontWeight: 700, color: 'var(--ink-2)' }}>
        No tests ordered yet — head to <strong>Order tests</strong>.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {patient.orderedTestIds.map((tid) => {
        const test = testById(tid);
        if (!test) return null;
        const done = completed.has(tid);
        const order = patient.investigationOrders.find((item) => item.investigationId === tid);
        const caseResult = order?.resultSnapshot;
        const report = done && caseResult ? { text: investigationResultText(caseResult.structuredResult, caseResult.resultText), abnormal: !!caseResult.abnormal } : null;
        const tone = order?.status === 'error' || order?.status === 'unavailable' ? 'var(--butter)' : report?.abnormal ? 'var(--rose)' : 'var(--mint)';
        const isImaging = test.category === 'imaging' || tid === 'ecg';
        const images: Array<{ url: string; caption: string; credit: string }> = [];
        return (
          <details
            key={tid}
            className="plush"
            style={{ padding: 12, background: 'white' }}
          >
            <summary
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                listStyle: 'none',
                fontWeight: 800,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: tone,
                  border: '2px solid var(--line)',
                }}
              />
              <span>{test.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-2)' }}>
                {order?.status ?? 'pending'}
              </span>
            </summary>

            {images.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {images.map((img, i) => (
                  <figure
                    key={i}
                    style={{
                      margin: 0,
                      background: '#0b0b0d',
                      borderRadius: 12,
                      border: '2px solid var(--line)',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src={img.url}
                      alt={img.caption}
                      loading="lazy"
                      onClick={() => setZoomed({ url: img.url, caption: img.caption, credit: img.credit })}
                      title="Click to zoom"
                      style={{
                        display: 'block',
                        width: '100%',
                        maxHeight: 420,
                        objectFit: 'contain',
                        background: '#0b0b0d',
                        cursor: 'zoom-in',
                      }}
                    />
                    <figcaption
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        color: '#d8d8dc',
                        fontWeight: 600,
                        background: '#0b0b0d',
                      }}
                    >
                      {img.caption}
                      <span style={{ display: 'block', opacity: 0.6, marginTop: 2 }}>
                        {img.credit}
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {done && isImaging && images.length === 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: 'var(--cream)', fontSize: 12, fontWeight: 700 }}>
                Educational image not available. Use the case-specific written report below.
              </div>
            )}

            <details style={{ marginTop: 10 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  listStyle: 'none',
                }}
              >
                {images.length > 0 ? '▸ Show written report' : '▸ Show details'}
              </summary>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'ui-monospace, monospace',
                  background: 'var(--cream)',
                  padding: 10,
                  borderRadius: 10,
                  border: '2px solid var(--line)',
                }}
              >
                {report?.text ?? 'Pending…'}
                {order?.statusDetail ? `\n${order.statusDetail}` : ''}
              </div>
            </details>
          </details>
        );
      })}

      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-label="Imaging viewer"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 'var(--layer-popover)',
            background: 'rgba(0,0,0,0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            cursor: 'zoom-out',
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setZoomed(null);
            }}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'rgba(255,255,255,0.12)',
              color: 'white',
              border: '2px solid rgba(255,255,255,0.25)',
              borderRadius: 12,
              padding: '8px 14px',
              fontWeight: 800,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            title="Close (Esc)"
          >
            ✕ Close
          </button>
          <img
            src={zoomed.url}
            alt={zoomed.caption}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '95vw',
              maxHeight: '85vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              cursor: 'default',
            }}
          />
          <div
            style={{
              marginTop: 14,
              color: '#e8e8ec',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
              maxWidth: '90vw',
            }}
          >
            {zoomed.caption}
            <div style={{ opacity: 0.6, fontSize: 11, marginTop: 4 }}>{zoomed.credit}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Diagnose tab ─────────────────────────────────────────────────

// Mulberry32 PRNG seeded from a case id — stable across remounts so the

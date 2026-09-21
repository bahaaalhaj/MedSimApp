import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { ClinicId } from '../../game/clinic';
import type { ActivePatient } from '../../game/types';

type Props = {
  patient: ActivePatient;
  currentClinic: ClinicId;
  onOrderTest: (testId: string, indication?: string) => void;
  onOrderPanel: (testIds: string[]) => void;
};

export function InvestigationsTab({ patient, currentClinic, onOrderTest, onOrderPanel }: Props) {
  const [testQuery, setTestQuery] = useState('');
  const ordered = new Set(patient.orderedTestIds);
  const groups = useMemo(() => {
    const out = new Map<string, typeof patient.investigationCatalogue>();
    for (const item of patient.investigationCatalogue.filter((candidate) => `${candidate.name} ${candidate.category} ${candidate.role}`.toLowerCase().includes(testQuery.trim().toLowerCase()))) {
      const category = item.testId.startsWith('urine') || item.testId === 'beta-hcg-q' ? 'Urine tests'
        : item.category === 'laboratory' || item.category === 'pathology' ? 'Blood tests'
          : item.category === 'microbiology' ? 'Microbiology'
            : item.category === 'cardiac' ? 'Cardiac tests'
              : item.category === 'physiological' && ['peak-flow', 'spirometry'].includes(item.testId) ? 'Respiratory tests'
                : item.category === 'imaging' ? 'Imaging'
                  : item.category === 'bedside' ? 'Bedside'
                    : 'Specialist procedures';
      out.set(category, [...(out.get(category) ?? []), item]);
    }
    return out;
  }, [patient.investigationCatalogue, testQuery]);

  // Specialty-aware panel filter: only panels tagged for the active clinic.
  // 'all-specialties' surfaces every polyclinic panel; ED-only panels (no
  // clinicIds) are always hidden from the polyclinic view.
  const visiblePanels: Array<{ id: string; label: string; description: string; testIds: string[] }> = [];

  const orderPanel = (testIds: string[]) => { onOrderPanel(testIds); };

  const cardStyle: CSSProperties = {
    fontSize: 13,
    padding: '10px 12px',
    fontWeight: 700,
    textAlign: 'left' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
        Case-specific investigations are ordered individually. Results remain hidden while pending; no local fallback is used.
      </div>
      <input aria-label="Search investigations" value={testQuery} onChange={(event) => setTestQuery(event.target.value)} placeholder="Search investigations" style={{ padding: '10px 12px', border: '2px solid var(--line)', borderRadius: 10 }} />
      {patient.investigationAttemptStatus === 'error' && <div role="alert">Investigation service unavailable. No result was generated locally.</div>}

      {/* Panels — clinic-scoped, collapsible. */}
      {visiblePanels.length > 0 && (
        <CollapsibleSection
          icon="🧪"
          label={`Panels for ${currentClinic === 'all-specialties' ? 'every specialty' : 'this clinic'}`}
          count={visiblePanels.length}
          tone="var(--butter)"
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 8,
            }}
          >
            {visiblePanels.map((panel) => {
              const allOrdered = panel.testIds.every((id) => ordered.has(id));
              return (
                <button
                  key={panel.id}
                  type="button"
                  className={`tap btn-plush ${allOrdered ? '' : 'ghost'}`}
                  disabled={allOrdered}
                  onClick={() => orderPanel(panel.testIds)}
                  style={{
                    ...cardStyle,
                    opacity: allOrdered ? 0.55 : 1,
                    cursor: allOrdered ? 'default' : 'pointer',
                  }}
                  title={panel.description}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{allOrdered ? '✓ ' : ''}{panel.label}</strong>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        background: 'var(--cream)',
                        border: '2px solid var(--line)',
                        borderRadius: 'var(--r-pill)',
                        padding: '1px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {panel.testIds.length} tests
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', fontWeight: 700, marginTop: 4 }}>
                    {panel.description}
                  </div>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Per-category lists, also collapsible. */}
      {[...groups.entries()].map(([label, list]) => {
        const available = list.filter((t) => !ordered.has(t.testId));
        const icon = label === 'Bedside' ? '🩺' : label === 'Imaging' ? '📷' : '🧬';
        const tone = label === 'Bedside' ? 'var(--mint)' : label === 'Imaging' ? 'var(--peach)' : 'var(--sky)';
        return (
          <CollapsibleSection
            key={label}
            icon={icon}
            label={label}
            count={list.length}
            tone={tone}
            extra={`${available.length} available`}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8,
              }}
            >
              {list.map((t) => {
                const isOrdered = ordered.has(t.testId);
                const definition = t;
                const orderStatus = patient.investigationOrders.find((order) => order.investigationId === t.testId)?.status;
                return (
                  <button
                    key={t.testId}
                    type="button"
                    className={`tap btn-plush ${isOrdered ? '' : 'ghost'}`}
                    disabled={isOrdered}
                    onClick={() => {
                      const indication = definition?.role === 'conditional' ? window.prompt('Document the clinical indication for this conditional investigation:') ?? '' : '';
                      onOrderTest(t.testId, indication);
                    }}
                    style={{
                      ...cardStyle,
                      opacity: isOrdered ? 0.55 : 1,
                      cursor: isOrdered ? 'default' : 'pointer',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span>
                        {isOrdered ? '✓ ' : ''}
                        {t.name}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: isOrdered ? 'var(--mint-deep)' : 'var(--ink-2)',
                          background: 'var(--cream)',
                          border: '2px solid var(--line)',
                          borderRadius: 'var(--r-pill)',
                          padding: '1px 7px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {orderStatus ?? (isOrdered ? 'pending' : definition?.role ?? patient.investigationAttemptStatus)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

// ── Reusable collapsible section ─────────────────────────────────

function CollapsibleSection({
  icon,
  label,
  count,
  tone,
  extra,
  children,
  defaultOpen = false,
}: {
  icon: string;
  label: string;
  count: number;
  tone: string;
  extra?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="plush"
      open={defaultOpen}
      style={{
        padding: 0,
        background: 'white',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: tone,
            border: '3px solid var(--line)',
            borderRadius: 'var(--r-pill)',
            padding: '3px 12px',
            fontWeight: 800,
            fontSize: 12,
            boxShadow: 'var(--plush-tiny)',
          }}
        >
          {icon} {label}
        </span>
        <span
          className="chip"
          style={{ fontSize: 11, padding: '2px 8px' }}
        >
          {count}
        </span>
        {extra && (
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>
            {extra}
          </span>
        )}
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            fontSize: 14,
            color: 'var(--ink-2)',
            fontWeight: 900,
          }}
        >
          ▾
        </span>
      </summary>
      <div
        style={{
          padding: '0 14px 14px',
          borderTop: '2px dashed rgba(43,30,22,0.18)',
          marginTop: 6,
          paddingTop: 14,
        }}
      >
        {children}
      </div>
    </details>
  );
}


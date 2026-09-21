export type CriterionStatus = 'met' | 'partially-met' | 'missed';

export interface CriterionCitation {
  title: string;
  rec: string;
  loE: string;
  url?: string;
}

export interface CriterionCardProps {
  status: CriterionStatus;
  text: string;
  evidence: string;
  cite?: CriterionCitation;
}

const CRITERION_STYLES: Record<
  CriterionCardProps['status'],
  { icon: string; color: string; label: string; iconColor: string }
> = {
  met: { icon: '\u2713', color: 'var(--mint)', label: 'MET', iconColor: 'var(--mint-deep)' },
  'partially-met': { icon: '~', color: 'var(--butter)', label: 'PARTIAL', iconColor: 'var(--butter-deep)' },
  missed: { icon: '\u00D7', color: 'var(--rose)', label: 'MISSED', iconColor: 'var(--rose-deep)' },
};

export function CriterionCard({ status, text, evidence, cite }: CriterionCardProps) {
  const styles = CRITERION_STYLES[status];
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: 12,
        background: '#FFFCF3',
        border: '2.5px solid var(--line)',
        borderRadius: 14,
        boxShadow: '0 2px 0 var(--line)',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: styles.color,
          border: '2.5px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 900,
          fontSize: 20,
          color: styles.iconColor,
          flexShrink: 0,
        }}
      >
        {styles.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 900,
              padding: '2px 8px',
              borderRadius: 6,
              background: styles.color,
              border: '2px solid var(--line)',
            }}
          >
            {styles.label}
          </span>
          <span style={{ fontWeight: 800, fontSize: 14 }}>{text}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', fontStyle: 'italic' }}>
          {evidence}
        </div>
        {cite && (
          <div
            style={{
              marginTop: 8,
              background: 'var(--cream-2)',
              border: '2.5px dashed var(--line)',
              borderRadius: 10,
              padding: '8px 10px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 900, color: 'var(--ink)' }}>
              {'\uD83D\uDCD6 '}{cite.title}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{cite.rec}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mint-deep)', marginTop: 4 }}>
              {cite.loE}
              {cite.url && (
                <>
                  {' \u00B7 '}
                  <a href={cite.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-2)' }}>
                    open
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



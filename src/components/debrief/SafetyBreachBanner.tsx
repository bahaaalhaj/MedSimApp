type Citation = {
  title: string;
  rec: string;
  loE: string;
};

type Props = {
  description: string;
  cite?: Citation;
};

export function SafetyBreachBanner({ description, cite }: Props) {
  return (
    <div
      className="plush-lg popin"
      style={{
        background: 'var(--rose)',
        padding: 18,
        marginBottom: 18,
        border: '3px solid var(--line)',
      }}
    >
      <div className="chip" style={{ background: 'white', marginBottom: 8 }}>
        {'\u26A0 SAFETY BREACH'}
      </div>
      <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.4 }}>
        {description}
      </div>
      {cite && (
        <div
          style={{
            marginTop: 10,
            background: 'white',
            border: '2.5px dashed var(--line)',
            borderRadius: 10,
            padding: '8px 10px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 900 }}>{'\uD83D\uDCD6 '}{cite.title}</div>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{cite.rec}</div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--mint-deep)', marginTop: 4 }}>
            {cite.loE}
          </div>
        </div>
      )}
    </div>
  );
}

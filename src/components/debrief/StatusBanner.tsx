import { Doodle } from '../primitives';

export function StatusBanner({
  title,
  body,
  bg,
}: {
  title: string;
  body: string;
  bg: string;
}) {
  return (
    <div
      className="plush-lg popin"
      style={{
        background: bg,
        padding: 24,
        position: 'relative',
        marginBottom: 22,
        transform: 'rotate(-0.4deg)',
      }}
    >
      <div style={{ position: 'absolute', top: -14, left: 24 }} className="chip butter">
        ATTENDING
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
          <h1 style={{ fontSize: 32, lineHeight: 1.05, margin: '4px 0 8px' }}>{title}</h1>
          <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 600, color: 'var(--ink)' }}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}



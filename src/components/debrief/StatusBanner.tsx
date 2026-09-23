import { AttendingCardFrame } from './AttendingCardFrame';

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
    <AttendingCardFrame label="ATTENDING" background={bg}>
      <h1 style={{ fontSize: 32, lineHeight: 1.05, margin: '4px 0 8px' }}>{title}</h1>
      <div style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 600, color: 'var(--ink)' }}>
        {body}
      </div>
    </AttendingCardFrame>
  );
}


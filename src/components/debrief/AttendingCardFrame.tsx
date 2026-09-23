import type { ReactNode } from 'react';
import { Doodle } from '../primitives';

type AttendingCardFrameProps = {
  label: string;
  background: string;
  children: ReactNode;
};

/** Shared debrief-only shell; its fixed geometry keeps grading cards visually identical. */
export function AttendingCardFrame({ label, background, children }: AttendingCardFrameProps) {
  return (
    <div
      className="plush-lg popin"
      style={{
        background,
        padding: 'var(--space-10)',
        position: 'relative',
        marginBottom: 'var(--space-9)',
        transform: 'rotate(-0.4deg)',
      }}
    >
      <div style={{ position: 'absolute', top: -14, left: 'var(--space-10)' }} className="chip butter">
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-9)' }}>
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
        <div style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

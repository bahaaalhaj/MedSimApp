import { FormEvent, useState } from 'react';
import { DoodleScatter } from './primitives';
import { store, useGameState } from '../game/store';

export function LoginScreen() {
  const savedName = useGameState().learnerName ?? '';
  const [name, setName] = useState(savedName);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    store.continueWithLocalProfile(name);
  };

  return (
    <main className="screen bg-peach-soft" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
      <DoodleScatter items={[
        { kind: 'cloud', x: 70, y: 80, size: 110, color: '#fff' },
        { kind: 'sparkle', x: '82%', y: 110, size: 30, color: '#FFD86B' },
        { kind: 'stetho', x: '8%', y: '70%', size: 72, color: 'var(--mint)' },
      ]} />
      <form className="plush-lg popin" onSubmit={submit} style={{ width: 'min(460px, 100%)', padding: 34, zIndex: 1 }}>
        <span className="chip mint">MEDSIM LEARNER PROFILE</span>
        <h1 style={{ fontSize: 40, margin: '18px 0 8px' }}>Welcome to MedSim</h1>
        <p style={{ color: 'var(--ink-2)', fontWeight: 650, lineHeight: 1.55 }}>
          Enter a display name to keep your training history on this device.
        </p>
        <label htmlFor="learner-name" style={{ display: 'block', fontWeight: 900, margin: '24px 0 8px' }}>
          Display name
        </label>
        <input
          id="learner-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={80}
          required
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box', padding: '14px 16px', font: 'inherit',
            border: '3px solid var(--line)', borderRadius: 14, background: 'white',
          }}
        />
        <button type="submit" className="btn-plush primary" style={{ width: '100%', marginTop: 22, fontSize: 18 }}>
          Continue to outpatient training →
        </button>
        <p style={{ margin: '18px 0 0', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          Local prototype profile · not a secure online account. Server-managed accounts and
          cross-device progress are planned before academic deployment.
        </p>
      </form>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { store } from '../../game/store';
import { Doodle, DoodleScatter, Wordmark } from '../primitives';
import { GuestNotice } from './GuestNotice';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [hasPresentedForms, setHasPresentedForms] = useState(false);
  useEffect(() => {
    if (auth.status !== 'loading') setHasPresentedForms(true);
  }, [auth.status]);
  const checking = auth.status === 'loading' && !hasPresentedForms;

  return (
    <main className="screen auth-screen">
      <DoodleScatter items={[{ kind: 'sparkle', x: '7%', y: 90, size: 28, color: '#FFD86B' }, { kind: 'pill', x: '88%', y: 100, size: 66, anim: 'wobble' }, { kind: 'heart', x: '8%', y: '76%', size: 44, color: '#F47A92' }]} />
      <button type="button" className="auth-back" onClick={() => store.setScreen('splash')}>← Welcome</button>
      <section className="auth-shell" aria-labelledby="auth-title">
        <aside className="auth-intro">
          <Wordmark size={48} />
          <div className="auth-illustration"><Doodle kind="stetho" size={126} color="var(--mint)" /></div>
          <h1 id="auth-title">Welcome to your clinical practice space.</h1>
          <p>Sign in to keep your training history private and available across sessions.</p>
          <div className="chip mint">🔒 Secure, server-managed session</div>
        </aside>
        <div className="auth-card plush-lg">
          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Create Account</button>
          </div>
          {auth.error && <div className="auth-message auth-message--error" role="alert">{auth.error}</div>}
          {checking ? (
            <div className="auth-loading" role="status"><span className="auth-spinner" /> Checking your session…</div>
          ) : mode === 'login' ? (
            <LoginForm onCreateAccount={() => setMode('register')} />
          ) : (
            <RegisterForm onLogin={() => setMode('login')} />
          )}
          {!checking && <GuestNotice />}
          {auth.status === 'error' && <button type="button" className="auth-link" onClick={() => void auth.retry()}>Retry connection</button>}
        </div>
      </section>
    </main>
  );
}

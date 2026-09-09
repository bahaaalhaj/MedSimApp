import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { validateLogin } from '../../auth/validation';

export function LoginForm({ onCreateAccount }: { onCreateAccount(): void }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validateLogin({ email, password, remember });
    setErrors(next);
    if (Object.keys(next).length) return;
    try { await auth.login({ email: email.trim().toLowerCase(), password, remember }); } catch { /* shown by provider */ }
  };

  return (
    <form onSubmit={submit} noValidate className="auth-form">
      <div className="auth-field">
        <label htmlFor="login-email">Email address</label>
        <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'login-email-error' : undefined} />
        {errors.email && <span id="login-email-error" className="auth-error">{errors.email}</span>}
      </div>
      <div className="auth-field">
        <label htmlFor="login-password">Password</label>
        <div className="auth-password">
          <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'login-password-error' : undefined} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
        </div>
        {errors.password && <span id="login-password-error" className="auth-error">{errors.password}</span>}
      </div>
      <label className="auth-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Remember me on this device</span></label>
      <button className="btn-plush primary auth-submit" type="submit" disabled={auth.status === 'loading'}>{auth.status === 'loading' ? <><span className="auth-spinner" /> Signing in…</> : 'Login →'}</button>
      <button className="auth-link" type="button" onClick={onCreateAccount}>New here? Create an account</button>
    </form>
  );
}

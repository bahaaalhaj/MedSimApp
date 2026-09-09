import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { validateRegistration } from '../../auth/validation';

export function RegisterForm({ onLogin }: { onLogin(): void }) {
  const auth = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = displayName.trim().replace(/\s+/g, ' ');
    const next = validateRegistration({ displayName: cleanName, email, password, confirmPassword: confirm, termsAccepted });
    setErrors(next);
    if (Object.keys(next).length) return;
    try { await auth.register({ displayName: cleanName, email: email.trim().toLowerCase(), password, termsAccepted }); } catch { /* shown by provider */ }
  };

  return (
    <form onSubmit={submit} noValidate className="auth-form">
      <div className="auth-field"><label htmlFor="register-name">Display name</label><input id="register-name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? 'register-name-error' : undefined} />{errors.displayName && <span id="register-name-error" className="auth-error">{errors.displayName}</span>}</div>
      <div className="auth-field"><label htmlFor="register-email">Email address</label><input id="register-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'register-email-error' : undefined} />{errors.email && <span id="register-email-error" className="auth-error">{errors.email}</span>}</div>
      <div className="auth-field"><label htmlFor="register-password">Password</label><div className="auth-password"><input id="register-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'register-password-error' : undefined} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}>{showPassword ? 'Hide' : 'Show'}</button></div>{errors.password && <span id="register-password-error" className="auth-error">{errors.password}</span>}</div>
      <div className="auth-field"><label htmlFor="register-confirm">Confirm password</label><input id="register-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'register-confirm-error' : undefined} />{errors.confirm && <span id="register-confirm-error" className="auth-error">{errors.confirm}</span>}</div>
      <label className="auth-check"><input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} aria-describedby={errors.terms ? 'register-terms-error' : undefined} /><span>I acknowledge the terms and privacy notice.</span></label>
      {errors.terms && <span id="register-terms-error" className="auth-error">{errors.terms}</span>}
      <button className="btn-plush primary auth-submit" type="submit" disabled={auth.status === 'loading'}>{auth.status === 'loading' ? <><span className="auth-spinner" /> Creating…</> : 'Create Account →'}</button>
      <button className="auth-link" type="button" onClick={onLogin}>Already registered? Return to login</button>
    </form>
  );
}

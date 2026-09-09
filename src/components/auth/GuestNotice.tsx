import { useAuth } from '../../auth/AuthProvider';

export function GuestNotice() {
  const auth = useAuth();
  return (
    <div className="auth-guest">
      <div><strong>Prefer to explore first?</strong><span> Guest progress stays only on this device and is kept separate from every account.</span></div>
      <button type="button" className="btn-plush ghost" onClick={auth.continueAsGuest}>Continue as Guest</button>
    </div>
  );
}

import { capabilities } from '../../deploymentCapabilities';
import { useAuth } from '../../auth/AuthProvider';

export function GuestNotice() {
  const auth = useAuth();
  return (
    <div className="auth-guest">
      <div><strong>{capabilities().accounts ? 'Prefer to explore first?' : 'Enter the student demo'}</strong><span>{capabilities().accounts ? ' Guest progress stays only on this device and is kept separate from every account.' : ' Active encounters are temporarily stored on the demo server. Optional saved guest reviews stay on this device.'}</span></div>
      <button type="button" className="btn-plush ghost" onClick={auth.continueAsGuest}>Continue as Guest</button>
    </div>
  );
}

import { useEffect } from 'react';
import { store, useGameState, useScreen, useTweaks } from './game/store';
import { applyIntensity, applyPalette } from './styles/palettes';
import { SplashScreen } from './components/SplashScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { HomeScreen } from './components/HomeScreen';
import { GPRoomScreen } from './components/GPRoomScreen';
import { CaseLibraryScreen } from './components/CaseLibraryScreen';
import { BriefScreen } from './components/BriefScreen';
import { EncounterScreen } from './components/EncounterScreen';
import { EndConfirmScreen } from './components/EndConfirmScreen';
import { DebriefScreen } from './components/DebriefScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { BackgroundMusic } from './components/BackgroundMusic';
import { AuthScreen } from './components/auth/AuthScreen';
import { RuntimeDiagnostics } from './components/RuntimeDiagnostics';
import { useAuth } from './auth/AuthProvider';

export default function App() {
  const screen = useScreen();
  const tweaks = useTweaks();
  const auth = useAuth();
  const state = useGameState();
  const hasIdentity = auth.status === 'authenticated' || auth.status === 'guest';
  const isPublicScreen = screen === 'splash' || screen === 'onboarding' || screen === 'auth';
  const visibleScreen = !isPublicScreen && !hasIdentity ? 'auth' : screen;

  useEffect(() => {
    applyPalette(tweaks.palette);
  }, [tweaks.palette]);

  useEffect(() => {
    applyIntensity(tweaks.intensity);
  }, [tweaks.intensity]);

  useEffect(() => {
    const owner = auth.status === 'authenticated' ? `user:${auth.user?.id}` : auth.status === 'guest' ? `guest:${auth.guestId}` : null;
    if (owner) store.startNavigation(owner);
    else if (auth.status === 'unauthenticated') { store.clearExpiredIdentity(); store.startNavigation(null); }
    return () => store.stopNavigation();
  }, [auth.status, auth.user?.id, auth.guestId]);

  useEffect(() => {
    if (!isPublicScreen && !hasIdentity && auth.status !== 'loading') {
      store.setScreen('auth');
    }
  }, [auth.status, hasIdentity, isPublicScreen]);

  return (
    <div className="app">
      {auth.status === 'loading' ? <div className="screen paper" role="status">Restoring your session…</div> : state.recoveryStatus === 'loading' && hasIdentity ? <div className="screen paper" role="status">Recovering your encounter…</div> : state.recoveryStatus === 'error' && hasIdentity ? <div className="screen paper" role="alert" style={{ padding: 32 }}>
        <h1>Encounter unavailable</h1><p>{state.navigationNotice}</p>
        <button onClick={() => store.retryRecovery()}>Retry recovery</button>{' '}
        <button onClick={() => store.dismissRecovery()}>Choose a case</button>{' '}
        <button onClick={() => { store.dismissRecovery(); store.setScreen('history'); }}>Saved history</button>
      </div> : <>
      {hasIdentity && state.navigationNotice && <div role="status">{state.navigationNotice}</div>}
      {hasIdentity && state.recoverableEncounter && !['encounter', 'endConfirm', 'debrief'].includes(screen) && <button className="btn-plush" onClick={() => store.resumeEncounter()}>Resume previous encounter</button>}
      {visibleScreen === 'splash' && <SplashScreen />}
      {visibleScreen === 'onboarding' && <OnboardingScreen />}
      {visibleScreen === 'auth' && <AuthScreen />}
      {visibleScreen === 'home' && <HomeScreen />}
      {visibleScreen === 'gpRoom' && <GPRoomScreen />}
      {visibleScreen === 'library' && <CaseLibraryScreen />}
      {visibleScreen === 'brief' && <BriefScreen />}
      {visibleScreen === 'encounter' && <EncounterScreen />}
      {visibleScreen === 'endConfirm' && <EndConfirmScreen />}
      {visibleScreen === 'debrief' && <DebriefScreen />}
      {visibleScreen === 'history' && <HistoryScreen />}
      </>}
      <BackgroundMusic />
      <RuntimeDiagnostics />
    </div>
  );
}

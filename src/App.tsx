import { useEffect } from 'react';
import { store, useScreen, useTweaks } from './game/store';
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
    if (screen === 'auth' && hasIdentity) store.setScreen('gpRoom');
  }, [hasIdentity, screen]);

  useEffect(() => {
    if (!isPublicScreen && !hasIdentity && auth.status !== 'loading') {
      store.setScreen('auth');
    }
  }, [auth.status, hasIdentity, isPublicScreen]);

  return (
    <div className="app">
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
      <BackgroundMusic />
      <RuntimeDiagnostics />
    </div>
  );
}

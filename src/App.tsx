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
import { AgenticRoundsScreen } from './components/AgenticRoundsScreen';
import { AgentTopologyScreen } from './components/AgentTopologyScreen';
import { BackgroundMusic } from './components/BackgroundMusic';
import { AuthScreen } from './components/auth/AuthScreen';
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

  // Minimal path-based route: /agentic-rounds boots straight into the
  // architecture page so the demo can deep-link to it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname.replace(/\/+$/, '');
    if (import.meta.env.DEV && path === '/agentic-rounds') {
      store.setScreen('agenticRounds');
    } else if (import.meta.env.DEV && path === '/agent-topology') {
      store.setScreen('agentTopology');
    }
  }, []);

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
      {visibleScreen === 'agenticRounds' && <AgenticRoundsScreen />}
      {visibleScreen === 'agentTopology' && <AgentTopologyScreen />}
      <BackgroundMusic />
    </div>
  );
}

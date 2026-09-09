import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from './authApi';
import type { AuthState, LoginInput, RegisterInput } from './types';
import { store } from '../game/store';

const GUEST_ID_KEY = 'medsim:guest:id';
const GUEST_ACTIVE_KEY = 'medsim:guest:active';

let currentSnapshot: AuthState = { status: 'loading', user: null, guestId: null, error: null };
export const getAuthSnapshot = () => currentSnapshot;

interface AuthContextValue extends AuthState {
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  continueAsGuest(): void;
  logout(): Promise<void>;
  exitGuest(): void;
  retry(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function guestState(): AuthState | null {
  try {
    if (localStorage.getItem(GUEST_ACTIVE_KEY) !== '1') return null;
    const guestId = localStorage.getItem(GUEST_ID_KEY);
    return guestId ? { status: 'guest', user: null, guestId, error: null } : null;
  } catch {
    return null;
  }
}

function newGuestId(): string {
  return `guest_${crypto.randomUUID()}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(currentSnapshot);
  const commit = useCallback((next: AuthState) => {
    currentSnapshot = next;
    setState(next);
  }, []);

  const retry = useCallback(async () => {
    commit({ status: 'loading', user: null, guestId: null, error: null });
    try {
      const session = await api.getSession();
      if (session.authenticated && session.user) {
        commit({ status: 'authenticated', user: session.user, guestId: null, error: null, notice: 'Session restored.' });
      } else {
        commit(guestState() ?? { status: 'unauthenticated', user: null, guestId: null, error: null });
      }
    } catch (error) {
      commit({ status: 'error', user: null, guestId: null, error: error instanceof Error ? error.message : 'Unable to reach the sign-in service.' });
    }
  }, [commit]);

  useEffect(() => { void retry(); }, [retry]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    retry,
    login: async (input) => {
      commit({ status: 'loading', user: null, guestId: null, error: null });
      try {
        const user = await api.login(input);
        localStorage.removeItem(GUEST_ACTIVE_KEY);
        commit({ status: 'authenticated', user, guestId: null, error: null, notice: `Welcome back, ${user.displayName}.` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid email or password.';
        commit({ status: 'unauthenticated', user: null, guestId: null, error: message });
        throw error;
      }
    },
    register: async (input) => {
      commit({ status: 'loading', user: null, guestId: null, error: null });
      try {
        const user = await api.register(input);
        localStorage.removeItem(GUEST_ACTIVE_KEY);
        commit({ status: 'authenticated', user, guestId: null, error: null, notice: `Account created. Welcome, ${user.displayName}.` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create your account.';
        commit({ status: 'unauthenticated', user: null, guestId: null, error: message });
        throw error;
      }
    },
    continueAsGuest: () => {
      let guestId = localStorage.getItem(GUEST_ID_KEY);
      if (!guestId) {
        guestId = newGuestId();
        localStorage.setItem(GUEST_ID_KEY, guestId);
      }
      localStorage.setItem(GUEST_ACTIVE_KEY, '1');
      commit({ status: 'guest', user: null, guestId, error: null, notice: 'Guest mode started.' });
    },
    logout: async () => {
      try { await api.logout(); } finally {
        commit({ status: 'unauthenticated', user: null, guestId: null, error: null });
        store.resetForIdentityExit();
      }
    },
    exitGuest: () => {
      localStorage.removeItem(GUEST_ACTIVE_KEY);
      commit({ status: 'unauthenticated', user: null, guestId: null, error: null });
      store.resetForIdentityExit();
    },
  }), [commit, retry, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

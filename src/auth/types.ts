export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export type AuthStatus = 'loading' | 'authenticated' | 'guest' | 'unauthenticated' | 'error';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  guestId: string | null;
  error: string | null;
  notice?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
  termsAccepted: boolean;
}

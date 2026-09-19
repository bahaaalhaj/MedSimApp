import type { AuthUser, LoginInput, RegisterInput } from './types';
import { recordRuntimeDiagnostic } from '../runtimeDiagnostics.ts';

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'request_failed') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken: string;
}

let csrfToken = '';
let sessionRequest: Promise<SessionResponse> | null = null;

async function parse<T>(response: Response): Promise<T> {
  if (response.ok) return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
  let message = 'Something went wrong. Please try again.';
  let code = 'request_failed';
  try {
    const body = await response.json() as { detail?: string | { message?: string; code?: string } };
    if (typeof body.detail === 'string') message = body.detail;
    else if (body.detail) {
      message = body.detail.message ?? message;
      code = body.detail.code ?? code;
    }
  } catch {
    // Keep the friendly generic fallback for non-JSON proxy failures.
  }
  throw new AuthApiError(message, response.status, code);
}

export function getSession(): Promise<SessionResponse> {
  if (!sessionRequest) {
    const requestId = crypto.randomUUID(); const started = performance.now();
    recordRuntimeDiagnostic('auth-session-start', requestId);
    sessionRequest = fetch('/api/auth/session', { credentials: 'include', headers: { 'x-request-id': requestId } })
      .then((response) => parse<SessionResponse>(response))
      .then((session) => {
        csrfToken = session.csrfToken;
        recordRuntimeDiagnostic('auth-session-end', requestId, { durationMs: Math.round(performance.now() - started) }); return session;
      })
      .finally(() => {
        sessionRequest = null;
      });
  }
  return sessionRequest;
}

async function mutate<T>(path: string, body?: unknown): Promise<T> {
  if (!csrfToken) await getSession();
  const requestId = crypto.randomUUID(); const started = performance.now(); recordRuntimeDiagnostic('auth-mutate-start', requestId, { path });
  return parse<T>(await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      'x-request-id': requestId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })).finally(() => recordRuntimeDiagnostic('auth-mutate-end', requestId, { path, durationMs: Math.round(performance.now() - started) }));
}

export async function login(input: LoginInput): Promise<AuthUser> {
  const result = await mutate<{ user: AuthUser }>('/api/auth/login', input);
  return result.user;
}

export async function register(input: RegisterInput): Promise<AuthUser> {
  const result = await mutate<{ user: AuthUser }>('/api/auth/register', {
    display_name: input.displayName,
    email: input.email,
    password: input.password,
    terms_accepted: input.termsAccepted,
    remember: true,
  });
  return result.user;
}

export async function logout(): Promise<void> {
  await mutate<void>('/api/auth/logout');
}

export async function listAccountEncounters<T>(): Promise<T[]> {
  const result = await parse<{ encounters: T[] }>(await fetch('/api/progress/encounters', { credentials: 'include' }));
  return result.encounters;
}

export async function getAccountEncounter<T>(id: string): Promise<T | null> {
  const response = await fetch(`/api/progress/encounters/${encodeURIComponent(id)}`, { credentials: 'include' });
  if (response.status === 404) return null;
  return parse<T>(response);
}

export async function saveAccountEncounter<T>(payload: unknown): Promise<T> {
  return mutate<T>('/api/progress/encounters', payload);
}

export async function deleteAccountEncounter(id: string): Promise<void> {
  if (!csrfToken) await getSession();
  await parse<void>(await fetch(`/api/progress/encounters/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-csrf-token': csrfToken },
  }));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateLogin, validateRegistration } from '../../src/auth/validation.ts';
import * as authApi from '../../src/auth/authApi.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('login validation rejects malformed input and accepts valid input', () => {
  assert.deepEqual(validateLogin({ email: 'bad', password: '', remember: false }), {
    email: 'Enter a valid email address.',
    password: 'Enter your password.',
  });
  assert.deepEqual(validateLogin({ email: 'doctor@example.com', password: 'secret', remember: true }), {});
});

test('registration validation enforces name, password, confirmation, and terms', () => {
  const errors = validateRegistration({ displayName: 'A', email: 'bad', password: 'short', confirmPassword: 'other', termsAccepted: false });
  assert.deepEqual(Object.keys(errors).sort(), ['confirm', 'displayName', 'email', 'password', 'terms'].sort());
  assert.deepEqual(validateRegistration({ displayName: 'Dr Noor', email: 'noor@example.com', password: 'long-password', confirmPassword: 'long-password', termsAccepted: true }), {});
});

test('welcome and onboarding lead to auth, then identity continues to specialty selection', () => {
  const store = read('src/game/store.ts');
  const app = read('src/App.tsx');
  assert.match(store, /hasOnboarded \? 'auth' : 'onboarding'/);
  assert.match(store, /hasOnboarded: true, screen: 'auth'/);
  assert.match(app, /screen === 'auth' && hasIdentity/);
  assert.match(app, /store\.setScreen\('gpRoom'\)/);
});

test('protected screens are replaced by auth without an account or guest identity', () => {
  const app = read('src/App.tsx');
  assert.match(app, /!isPublicScreen && !hasIdentity \? 'auth' : screen/);
  assert.match(app, /!isPublicScreen && !hasIdentity && auth\.status !== 'loading'/);
});

test('login and account creation modes are keyboard-accessible tabs', () => {
  const screen = read('src/components/auth/AuthScreen.tsx');
  assert.match(screen, /role="tablist"/);
  assert.match(screen, /aria-selected=\{mode === 'login'\}/);
  assert.match(screen, /aria-selected=\{mode === 'register'\}/);
  assert.match(screen, /setMode\('register'\)/);
  assert.match(screen, /setMode\('login'\)/);
});

test('guest identity is namespaced and never uses account progress APIs', () => {
  const provider = read('src/auth/AuthProvider.tsx');
  const history = read('src/data/evalHistory.ts');
  assert.match(provider, /medsim:guest:id/);
  assert.match(history, /medsim:guest:\$\{guestId\}:eval-history/);
  assert.match(history, /auth\.status === 'authenticated'/);
  assert.match(history, /auth\.status === 'guest'/);
});

test('top bar uses current identity and exposes logout and guest exit', () => {
  const primitives = read('src/components/primitives.tsx');
  assert.match(primitives, /auth\.user\?\.displayName/);
  assert.match(primitives, /auth\.logout\(\)/);
  assert.match(primitives, /auth\.exitGuest\(\)/);
});

test('auth API restores a session and performs a successful login with cookies and CSRF', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/session')) {
      return Response.json({ authenticated: true, user: { id: 'u1', displayName: 'Dr Noor', email: 'noor@example.com', createdAt: '2026-01-01' }, csrfToken: 'csrf-test' });
    }
    return Response.json({ user: { id: 'u1', displayName: 'Dr Noor', email: 'noor@example.com', createdAt: '2026-01-01' } });
  };
  try {
    const session = await authApi.getSession();
    assert.equal(session.user?.displayName, 'Dr Noor');
    const user = await authApi.login({ email: 'noor@example.com', password: 'long-password', remember: true });
    assert.equal(user.displayName, 'Dr Noor');
    assert.equal(calls[1].init?.credentials, 'include');
    assert.equal((calls[1].init?.headers as Record<string, string>)['x-csrf-token'], 'csrf-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('auth API exposes the backend generic login failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(
    { detail: { code: 'invalid_credentials', message: 'Invalid email or password.' } },
    { status: 401 },
  );
  try {
    await assert.rejects(
      authApi.login({ email: 'nobody@example.com', password: 'wrong', remember: false }),
      /Invalid email or password/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  auth, initAuth, login, register, logout, changePassword, deleteAccount, saveSettings,
  validateUsername, validatePassword, currentUser
} from '../lib/auth.js';
import { mockFetch, apiError } from './helpers/fetch-mock.js';

const alice = { id: 'u1', username: 'alice', settings: {} };

beforeEach(() => {
  auth.set({ status: 'loading', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validation (mirrors the server rules)', () => {
  it.each(['abc', 'Alice_01', 'a-b'])('accepts username %s', (u) => {
    expect(validateUsername(u)).toBeNull();
  });

  it.each(['ab', 'a'.repeat(33), 'john doe', 'jürgen', ''])('rejects username %j', (u) => {
    expect(validateUsername(u)).toMatch(/3–32/);
  });

  it.each(['12345678', 'a'.repeat(128), '🔑'.repeat(8)])('accepts password %s', (p) => {
    expect(validatePassword(p)).toBeNull();
  });

  it.each(['1234567', 'a'.repeat(129), ''])('rejects password %j', (p) => {
    expect(validatePassword(p)).toMatch(/8–128/);
  });
});

describe('initAuth', () => {
  it('sets the user when a session exists', async () => {
    mockFetch({ 'GET /api/auth/me': { body: { user: alice } } });

    await initAuth();

    expect(get(auth)).toEqual({ status: 'user', user: alice });
    expect(currentUser()).toEqual(alice);
  });

  it('becomes guest on 401', async () => {
    mockFetch({ 'GET /api/auth/me': { status: 401, body: apiError('UNAUTHENTICATED') } });

    await initAuth();

    expect(get(auth)).toEqual({ status: 'guest', user: null });
  });

  it.each([
    ['no backend (network error)', () => { throw new TypeError('Failed to fetch'); }],
    ['proxy error', () => new Response('Bad Gateway', { status: 502 })],
    ['static hosting answering 404', () => new Response('<html>', { status: 404 })],
    ['an SPA fallback answering index.html with 200', () => new Response('<html>', { status: 200 })]
  ])('becomes unavailable with %s', async (_, respond) => {
    vi.stubGlobal('fetch', vi.fn(async () => respond()));

    await initAuth();

    expect(get(auth).status).toBe('unavailable');
  });
});

describe('actions', () => {
  it('login stores the user', async () => {
    const server = mockFetch({ 'POST /api/auth/login': { body: { user: alice } } });

    await login('alice', 'correct horse');

    expect(server.calls('POST /api/auth/login')[0].body).toEqual({ username: 'alice', password: 'correct horse' });
    expect(get(auth)).toEqual({ status: 'user', user: alice });
  });

  it('register stores the user', async () => {
    mockFetch({ 'POST /api/auth/register': { status: 201, body: { user: alice } } });

    await register('alice', 'correct horse');

    expect(get(auth).user).toEqual(alice);
  });

  it('a failed login keeps the guest state and rethrows', async () => {
    auth.set({ status: 'guest', user: null });
    mockFetch({ 'POST /api/auth/login': { status: 401, body: apiError('INVALID_CREDENTIALS') } });

    await expect(login('alice', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(get(auth).status).toBe('guest');
  });

  it('saveSettings replaces the account settings', async () => {
    const server = mockFetch({ 'PUT /api/auth/settings': { status: 204 } });

    await saveSettings({ wordsPerMinute: 450 });

    expect(server.calls('PUT /api/auth/settings')[0].body).toEqual({ settings: { wordsPerMinute: 450 } });
  });

  it('logout returns to guest', async () => {
    auth.set({ status: 'user', user: alice });
    mockFetch({ 'POST /api/auth/logout': { status: 204 } });

    await logout();

    expect(get(auth)).toEqual({ status: 'guest', user: null });
  });

  it('a failed logout keeps the user signed in', async () => {
    auth.set({ status: 'user', user: alice });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

    await expect(logout()).rejects.toMatchObject({ code: 'NETWORK' });
    expect(get(auth).status).toBe('user');
  });

  it('changePassword sends both passwords and keeps the user', async () => {
    auth.set({ status: 'user', user: alice });
    const server = mockFetch({ 'POST /api/auth/password': { status: 204 } });

    await changePassword('old password', 'new password');

    expect(server.calls('POST /api/auth/password')[0].body).toEqual({
      currentPassword: 'old password',
      newPassword: 'new password'
    });
    expect(get(auth).status).toBe('user');
  });

  it.each([
    ['changePassword', () => changePassword('old password', 'new password'), 'POST /api/auth/password'],
    ['deleteAccount', () => deleteAccount('correct horse'), 'DELETE /api/auth/account']
  ])('%s signs out locally when the session is gone (401)', async (_, action, route) => {
    auth.set({ status: 'user', user: alice });
    mockFetch({ [route]: { status: 401, body: apiError('UNAUTHENTICATED', 'Not logged in') } });

    await expect(action()).rejects.toMatchObject({ status: 401 });
    expect(get(auth)).toEqual({ status: 'guest', user: null });
  });

  it('a wrong current password keeps the user signed in', async () => {
    auth.set({ status: 'user', user: alice });
    mockFetch({ 'POST /api/auth/password': { status: 403, body: apiError('INVALID_PASSWORD') } });

    await expect(changePassword('wrong', 'new password')).rejects.toMatchObject({ status: 403 });
    expect(get(auth).status).toBe('user');
  });

  it('deleteAccount returns to guest', async () => {
    auth.set({ status: 'user', user: alice });
    const server = mockFetch({ 'DELETE /api/auth/account': { status: 204 } });

    await deleteAccount('correct horse');

    expect(server.calls('DELETE /api/auth/account')[0].body).toEqual({ password: 'correct horse' });
    expect(get(auth).status).toBe('guest');
  });
});

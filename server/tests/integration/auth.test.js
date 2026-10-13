import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { setupTestApp, sessionCookie, request, TEST_ORIGIN, RELAXED_RATE_LIMITS } from '../helpers/app.js';
import { createUser, createText, createProgress, countRows } from '../helpers/fixtures.js';
import { createSession, hashToken } from '../../src/auth/sessions.js';

const ctx = setupTestApp();

const register = (body) => ctx.request('POST', '/api/auth/register', { body });
const login = (body, options = {}) => ctx.request('POST', '/api/auth/login', { body, ...options });
const me = (cookie) => ctx.request('GET', '/api/auth/me', { cookie });

describe('POST /api/auth/register', () => {
  it('creates the user, logs them in and returns the public user', async () => {
    const res = await register({ username: 'Alice', password: 'correct horse' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      user: { id: expect.any(String), username: 'Alice', settings: {} }
    });
    expect((await me(sessionCookie(res))).body.user.username).toBe('Alice');
  });

  it('stores an argon2id hash, never the password', async () => {
    await register({ username: 'alice', password: 'correct horse' });

    const { rows } = await ctx.pool.query('SELECT password_hash FROM users');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain('correct horse');
  });

  it('sets a hardened session cookie', async () => {
    const res = await register({ username: 'alice', password: 'correct horse' });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='));

    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);
    // The test app runs with cookieSecure: false; see the Secure test below
    expect(cookie).not.toMatch(/Secure/);
  });

  it('marks the cookie Secure when cookieSecure is enabled (the default)', async () => {
    const app = createApp({ pool: ctx.pool, origin: TEST_ORIGIN, rateLimits: RELAXED_RATE_LIMITS });

    const res = await request(app, 'POST', '/api/auth/register', {
      body: { username: 'alice', password: 'correct horse' }
    });

    expect(res.headers.getSetCookie().find((c) => c.startsWith('sid='))).toMatch(/; Secure/);
  });

  it('stores only a hash of the session token', async () => {
    const res = await register({ username: 'alice', password: 'correct horse' });
    const token = sessionCookie(res).split('=')[1];

    const { rows } = await ctx.pool.query('SELECT id FROM sessions');
    expect(rows).toEqual([{ id: hashToken(token) }]);
  });

  it('rejects taken usernames case-insensitively with 409', async () => {
    await register({ username: 'Alice', password: 'correct horse' });

    const res = await register({ username: 'ALICE', password: 'another one' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USERNAME_TAKEN');
    expect(sessionCookie(res)).toBeNull();
  });

  it.each([
    [{ username: 'ab', password: 'correct horse' }, /Username/],
    [{ username: 'john doe', password: 'correct horse' }, /Username/],
    [{ username: 'alice', password: 'short' }, /Password/],
    [{ username: 'alice' }, /Password/],
    [{ password: 'correct horse' }, /Username/]
  ])('rejects invalid input %j with 400', async (body, message) => {
    const res = await register(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.message).toMatch(message);
    expect(await countRows(ctx.pool, 'users')).toBe(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await register('{not json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in case-insensitively and returns the stored username', async () => {
    await createUser(ctx.pool, { username: 'Alice', password: 'correct horse' });

    const res = await login({ username: 'alice', password: 'correct horse' });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('Alice');
    expect((await me(sessionCookie(res))).status).toBe(200);
  });

  it('returns the user settings', async () => {
    await createUser(ctx.pool, { username: 'alice', password: 'correct horse', settings: { wordsPerMinute: 450 } });

    const res = await login({ username: 'alice', password: 'correct horse' });

    expect(res.body.user.settings).toEqual({ wordsPerMinute: 450 });
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    await createUser(ctx.pool, { username: 'alice', password: 'correct horse' });

    const wrongPassword = await login({ username: 'alice', password: 'wrong horse' });
    const unknownUser = await login({ username: 'bob', password: 'correct horse' });

    for (const res of [wrongPassword, unknownUser]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password' }
      });
      expect(sessionCookie(res)).toBeNull();
    }
  });

  it('requires username and password strings', async () => {
    const res = await login({ username: 'alice' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('replaces the session the client already had', async () => {
    const { cookie: oldCookie } = await ctx.loggedInUser({ username: 'alice', password: 'correct horse' });

    const res = await login({ username: 'alice', password: 'correct horse' }, { cookie: oldCookie });

    expect((await me(oldCookie)).status).toBe(401);
    expect((await me(sessionCookie(res))).status).toBe(200);
    expect(await countRows(ctx.pool, 'sessions')).toBe(1);
  });

  it('allows several devices to be logged in at once', async () => {
    await createUser(ctx.pool, { username: 'alice', password: 'correct horse' });

    const phone = sessionCookie(await login({ username: 'alice', password: 'correct horse' }));
    const laptop = sessionCookie(await login({ username: 'alice', password: 'correct horse' }));

    expect((await me(phone)).status).toBe(200);
    expect((await me(laptop)).status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session and clears the cookie', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await ctx.request('POST', '/api/auth/logout', { body: {}, cookie });

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join()).toMatch(/sid=;.*Max-Age=0/);
    expect((await me(cookie)).status).toBe(401);
    expect(await countRows(ctx.pool, 'sessions')).toBe(0);
  });

  it('only ends the current session', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const other = await createSession(ctx.pool, user.id);

    await ctx.request('POST', '/api/auth/logout', { body: {}, cookie });

    expect((await me(`sid=${other.token}`)).status).toBe(200);
  });

  it('succeeds without a session', async () => {
    const res = await ctx.request('POST', '/api/auth/logout', { body: {} });

    expect(res.status).toBe(204);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the logged-in user', async () => {
    const { user, cookie } = await ctx.loggedInUser({ username: 'alice' });

    const res = await me(cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: user.id, username: 'alice', settings: {} } });
  });

  it('returns 401 without a cookie', async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['sid=unknown-token', 'sid=' + 'A'.repeat(43)])('returns 401 and clears an invalid cookie (%s)', async (cookie) => {
    const res = await me(cookie);

    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().join()).toMatch(/sid=;/);
  });
});

describe('PUT /api/auth/settings', () => {
  const putSettings = (cookie, body) => ctx.request('PUT', '/api/auth/settings', { body, cookie });

  it('replaces the settings returned by /me', async () => {
    const { cookie } = await ctx.loggedInUser({ settings: { wordsPerMinute: 450, fadeEnabled: true } });

    const res = await putSettings(cookie, { settings: { wordsPerMinute: 600, showContextEnabled: false } });

    expect(res.status).toBe(204);
    expect((await me(cookie)).body.user.settings).toEqual({ wordsPerMinute: 600, showContextEnabled: false });
  });

  it('only changes the own settings', async () => {
    const alice = await ctx.loggedInUser({ settings: { wordsPerMinute: 450 } });
    const bob = await ctx.loggedInUser();

    await putSettings(bob.cookie, { settings: { wordsPerMinute: 600 } });

    expect((await me(alice.cookie)).body.user.settings).toEqual({ wordsPerMinute: 450 });
  });

  it.each([
    ['missing settings', {}],
    ['an array', { settings: [] }],
    ['an unknown key', { settings: { theme: 'dark' } }],
    ['a string for a number', { settings: { wordsPerMinute: '300' } }],
    ['a number for a boolean', { settings: { fadeEnabled: 1 } }],
    ['a negative number', { settings: { pauseDuration: -1 } }]
  ])('rejects %s with 400 and keeps the settings', async (_, body) => {
    const { cookie } = await ctx.loggedInUser({ settings: { wordsPerMinute: 450 } });

    const res = await putSettings(cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect((await me(cookie)).body.user.settings).toEqual({ wordsPerMinute: 450 });
  });

  it('requires login', async () => {
    const res = await putSettings(undefined, { settings: {} });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/password', () => {
  const changePassword = (cookie, body) => ctx.request('POST', '/api/auth/password', { body, cookie });

  it('changes the password', async () => {
    const { cookie } = await ctx.loggedInUser({ username: 'alice', password: 'old password' });

    const res = await changePassword(cookie, { currentPassword: 'old password', newPassword: 'new password' });

    expect(res.status).toBe(204);
    expect((await login({ username: 'alice', password: 'old password' })).status).toBe(401);
    expect((await login({ username: 'alice', password: 'new password' })).status).toBe(200);
  });

  it('keeps the current session but signs out all others', async () => {
    const { user, cookie } = await ctx.loggedInUser({ password: 'old password' });
    const other = await createSession(ctx.pool, user.id);

    await changePassword(cookie, { currentPassword: 'old password', newPassword: 'new password' });

    expect((await me(cookie)).status).toBe(200);
    expect((await me(`sid=${other.token}`)).status).toBe(401);
  });

  it('does not touch other users\' sessions', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'old password' });
    const bob = await ctx.loggedInUser();

    await changePassword(cookie, { currentPassword: 'old password', newPassword: 'new password' });

    expect((await me(bob.cookie)).status).toBe(200);
  });

  it('rejects a wrong current password with 403', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'old password' });

    const res = await changePassword(cookie, { currentPassword: 'nope nope', newPassword: 'new password' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
  });

  it('validates the new password', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'old password' });

    const res = await changePassword(cookie, { currentPassword: 'old password', newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('requires login', async () => {
    const res = await changePassword(undefined, { currentPassword: 'x', newPassword: 'new password' });

    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/account', () => {
  const deleteAccount = (cookie, body) => ctx.request('DELETE', '/api/auth/account', { body, cookie });

  it('deletes the user with texts, progress and sessions', async () => {
    const { user, cookie } = await ctx.loggedInUser({ password: 'correct horse' });
    const text = await createText(ctx.pool, user.id);
    await createProgress(ctx.pool, user.id, text.id);

    const res = await deleteAccount(cookie, { password: 'correct horse' });

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().join()).toMatch(/sid=;/);
    for (const table of ['users', 'texts', 'progress', 'sessions']) {
      expect(await countRows(ctx.pool, table), table).toBe(0);
    }
  });

  it('leaves other users untouched', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });
    const bob = await ctx.loggedInUser();
    await createText(ctx.pool, bob.user.id);

    await deleteAccount(cookie, { password: 'correct horse' });

    expect(await countRows(ctx.pool, 'users')).toBe(1);
    expect(await countRows(ctx.pool, 'texts')).toBe(1);
    expect((await me(bob.cookie)).status).toBe(200);
  });

  it('frees the username', async () => {
    const { cookie } = await ctx.loggedInUser({ username: 'alice', password: 'correct horse' });
    await deleteAccount(cookie, { password: 'correct horse' });

    expect((await register({ username: 'alice', password: 'fresh start' })).status).toBe(201);
  });

  it('requires the correct password', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });

    const res = await deleteAccount(cookie, { password: 'wrong horse' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    expect(await countRows(ctx.pool, 'users')).toBe(1);
  });

  it('requires login', async () => {
    const res = await deleteAccount(undefined, { password: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('CSRF on auth routes', () => {
  it('rejects a cross-origin login even with valid credentials', async () => {
    await createUser(ctx.pool, { username: 'alice', password: 'correct horse' });

    const res = await login(
      { username: 'alice', password: 'correct horse' },
      { headers: { Origin: 'https://evil.example' } }
    );

    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeNull();
  });

  it('rejects a cross-origin account deletion', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });

    const res = await ctx.request('DELETE', '/api/auth/account', {
      body: { password: 'correct horse' },
      cookie,
      headers: { Origin: 'https://evil.example' }
    });

    expect(res.status).toBe(403);
    expect(await countRows(ctx.pool, 'users')).toBe(1);
  });
});

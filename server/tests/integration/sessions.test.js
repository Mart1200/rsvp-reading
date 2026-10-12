import { describe, it, expect } from 'vitest';
import { setupTestApp } from '../helpers/app.js';
import { createUser, countRows } from '../helpers/fixtures.js';
import {
  createSession, findSession, hashToken,
  SESSION_TTL_MS, SESSION_REFRESH_INTERVAL_MS
} from '../../src/auth/sessions.js';

const ctx = setupTestApp();
const DAY = 24 * 60 * 60 * 1000;

async function storedExpiry(token) {
  const { rows } = await ctx.pool.query('SELECT expires_at FROM sessions WHERE id = $1', [hashToken(token)]);
  return rows[0]?.expires_at;
}

describe('sessions', () => {
  it('expire after 30 days', async () => {
    const user = await createUser(ctx.pool);
    const now = new Date('2026-01-01T00:00:00Z');

    const { token, expiresAt } = await createSession(ctx.pool, user.id, now);

    expect(expiresAt.getTime() - now.getTime()).toBe(SESSION_TTL_MS);
    expect((await storedExpiry(token)).getTime()).toBe(expiresAt.getTime());
  });

  it('are found with their user', async () => {
    const user = await createUser(ctx.pool, { username: 'alice' });
    const { token } = await createSession(ctx.pool, user.id);

    const session = await findSession(ctx.pool, token);

    expect(session.user).toEqual({ id: user.id, username: 'alice', settings: {} });
  });

  it('are not extended within the first day (no write per request)', async () => {
    const user = await createUser(ctx.pool);
    const start = new Date('2026-01-01T00:00:00Z');
    const { token, expiresAt } = await createSession(ctx.pool, user.id, start);

    const session = await findSession(ctx.pool, token, new Date(start.getTime() + SESSION_REFRESH_INTERVAL_MS - 1));

    expect(session.refreshed).toBe(false);
    expect((await storedExpiry(token)).getTime()).toBe(expiresAt.getTime());
  });

  it('slide to 30 days from now once a day has passed', async () => {
    const user = await createUser(ctx.pool);
    const start = new Date('2026-01-01T00:00:00Z');
    const { token } = await createSession(ctx.pool, user.id, start);
    const later = new Date(start.getTime() + 10 * DAY);

    const session = await findSession(ctx.pool, token, later);

    expect(session.refreshed).toBe(true);
    expect(session.expiresAt.getTime()).toBe(later.getTime() + SESSION_TTL_MS);
    expect((await storedExpiry(token)).getTime()).toBe(later.getTime() + SESSION_TTL_MS);
  });

  it('are rejected and deleted once expired', async () => {
    const user = await createUser(ctx.pool);
    const start = new Date('2026-01-01T00:00:00Z');
    const { token } = await createSession(ctx.pool, user.id, start);

    const session = await findSession(ctx.pool, token, new Date(start.getTime() + SESSION_TTL_MS));

    expect(session).toBeNull();
    expect(await countRows(ctx.pool, 'sessions')).toBe(0);
  });

  it('clean up the user\'s expired sessions when a new one is created', async () => {
    const user = await createUser(ctx.pool);
    const start = new Date('2026-01-01T00:00:00Z');
    await createSession(ctx.pool, user.id, start);

    await createSession(ctx.pool, user.id, new Date(start.getTime() + SESSION_TTL_MS + 1));

    expect(await countRows(ctx.pool, 'sessions')).toBe(1);
  });

  it.each([undefined, '', 'short', 'x'.repeat(43) + '!', 'A'.repeat(44)])(
    'ignore malformed tokens without querying (%j)',
    async (token) => {
      expect(await findSession(ctx.pool, token)).toBeNull();
    }
  );
});

describe('sliding expiry over HTTP', () => {
  it('re-sends the cookie with the new expiry when the session was extended', async () => {
    const user = await createUser(ctx.pool);
    const { token } = await createSession(ctx.pool, user.id, new Date(Date.now() - 2 * DAY));

    const res = await ctx.request('GET', '/api/auth/me', { cookie: `sid=${token}` });

    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
    expect(cookie).toContain(`sid=${token}`);
  });

  it('does not re-send the cookie when nothing changed', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await ctx.request('GET', '/api/auth/me', { cookie });

    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

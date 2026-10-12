import { describe, it, expect } from 'vitest';
import { setupTestApp, TEST_ORIGIN } from '../helpers/app.js';
import { createUser } from '../helpers/fixtures.js';

// Spec limits, but with trustProxy so tests can simulate different client IPs.
// The cross-username/cross-IP caps are tested separately in rate-limits-global.test.js.
const ctx = setupTestApp({
  trustProxy: true,
  rateLimits: {
    login: { limit: 5, windowMs: 60_000 },
    loginIp: { limit: 1000, windowMs: 60_000 },
    loginAccount: { limit: 1000, windowMs: 60_000 },
    register: { limit: 10, windowMs: 3_600_000 },
    password: { limit: 5, windowMs: 60_000 }
  }
});

const fromIp = (ip) => ({ 'X-Forwarded-For': ip, Origin: TEST_ORIGIN });
const login = (username, password, ip = '10.0.0.1') =>
  ctx.request('POST', '/api/auth/login', { body: { username, password }, headers: fromIp(ip) });

// Each test uses its own usernames and IPs because the limiters live as long as the app
describe('login rate limit', () => {
  it('blocks the 6th failed attempt within a minute with 429 and Retry-After', async () => {
    await createUser(ctx.pool, { username: 'victim1', password: 'correct horse' });

    for (let i = 0; i < 5; i++) {
      expect((await login('victim1', 'wrong guess')).status).toBe(401);
    }
    const res = await login('victim1', 'wrong guess');

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('also blocks the correct password once limited', async () => {
    await createUser(ctx.pool, { username: 'victim2', password: 'correct horse' });
    for (let i = 0; i < 5; i++) await login('victim2', 'wrong guess');

    expect((await login('victim2', 'correct horse')).status).toBe(429);
  });

  it('counts per username case-insensitively', async () => {
    await createUser(ctx.pool, { username: 'victim3', password: 'correct horse' });
    for (let i = 0; i < 5; i++) await login(i % 2 ? 'VICTIM3' : 'victim3', 'wrong guess');

    expect((await login('Victim3', 'wrong guess')).status).toBe(429);
  });

  it('does not block the same username from another IP', async () => {
    await createUser(ctx.pool, { username: 'victim4', password: 'correct horse' });
    for (let i = 0; i < 5; i++) await login('victim4', 'wrong guess', '10.0.0.4');

    expect((await login('victim4', 'correct horse', '10.0.0.5')).status).toBe(200);
  });

  it('does not count successful logins and resets after one', async () => {
    await createUser(ctx.pool, { username: 'victim5', password: 'correct horse' });
    for (let i = 0; i < 4; i++) await login('victim5', 'wrong guess');
    expect((await login('victim5', 'correct horse')).status).toBe(200);

    for (let i = 0; i < 4; i++) {
      expect((await login('victim5', 'wrong guess')).status).toBe(401);
    }
  });

  it('caps the key length so huge usernames cannot bloat memory', async () => {
    const huge = 'x'.repeat(100_000);
    for (let i = 0; i < 5; i++) await login(huge, 'wrong guess', '10.0.0.6');

    // Same first 64 characters -> same bucket
    expect((await login('x'.repeat(64) + 'different', 'wrong guess', '10.0.0.6')).status).toBe(429);
  });

  it('holds under concurrent requests (attempts are reserved before verifying)', async () => {
    await createUser(ctx.pool, { username: 'victim_race', password: 'correct horse' });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => login('victim_race', 'wrong guess', '10.0.0.7'))
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it('also limits guesses for unknown usernames', async () => {
    for (let i = 0; i < 5; i++) await login('ghost', 'wrong guess');

    expect((await login('ghost', 'wrong guess')).status).toBe(429);
  });
});

describe('registration rate limit', () => {
  const register = (username, ip) => ctx.request('POST', '/api/auth/register', {
    body: { username, password: 'correct horse' },
    headers: fromIp(ip)
  });

  it('allows 10 registrations per IP per hour', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await register(`reg_a${i}`, '10.1.0.1')).status).toBe(201);
    }
    const res = await register('reg_a10', '10.1.0.1');

    expect(res.status).toBe(429);
    expect((await register('reg_b0', '10.1.0.2')).status).toBe(201);
  });

  it('does not charge invalid input or taken usernames', async () => {
    await createUser(ctx.pool, { username: 'taken_name' });
    for (let i = 0; i < 10; i++) {
      expect((await register('x', '10.1.0.3')).status).toBe(400);
      expect((await register('TAKEN_NAME', '10.1.0.3')).status).toBe(409);
    }

    expect((await register('valid_name', '10.1.0.3')).status).toBe(201);
  });

  it('holds under concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) => register(`race_${i}`, '10.1.0.4'))
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });
});

describe('current password rate limit', () => {
  it('limits wrong current passwords per user', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });
    const change = (currentPassword) => ctx.request('POST', '/api/auth/password', {
      body: { currentPassword, newPassword: 'new password' },
      cookie
    });

    for (let i = 0; i < 5; i++) expect((await change('wrong guess')).status).toBe(403);

    expect((await change('correct horse')).status).toBe(429);
  });

  it('holds under concurrent requests with a stolen session', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });

    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      ctx.request('DELETE', '/api/auth/account', { body: { password: `guess ${i}` }, cookie })
    ));
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 403)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });

  it('resets after the correct password', async () => {
    const { cookie } = await ctx.loggedInUser({ password: 'correct horse' });
    const change = (currentPassword, newPassword) => ctx.request('POST', '/api/auth/password', {
      body: { currentPassword, newPassword },
      cookie
    });

    for (let i = 0; i < 4; i++) await change('wrong guess', 'new password');
    expect((await change('correct horse', 'second password')).status).toBe(204);

    for (let i = 0; i < 5; i++) expect((await change('wrong guess', 'x password')).status).toBe(403);
  });
});

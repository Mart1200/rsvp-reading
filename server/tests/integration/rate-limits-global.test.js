import { describe, it, expect } from 'vitest';
import { setupTestApp, TEST_ORIGIN } from '../helpers/app.js';
import { createUser } from '../helpers/fixtures.js';

// Small caps so the cross-username and cross-IP limits are quick to reach.
// The per IP + username limit is relaxed here; it is tested in rate-limits.test.js.
const ctx = setupTestApp({
  trustProxy: true,
  rateLimits: {
    login: { limit: 1000, windowMs: 60_000 },
    loginIp: { limit: 4, windowMs: 60_000 },
    loginAccount: { limit: 6, windowMs: 60_000 }
  }
});

const login = (username, password, ip) => ctx.request('POST', '/api/auth/login', {
  body: { username, password },
  headers: { 'X-Forwarded-For': ip, Origin: TEST_ORIGIN }
});

describe('per-IP cap across usernames (password spraying)', () => {
  it('blocks an IP that tries one password against many usernames', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await login(`spray_${i}`, 'Summer2026!', '10.2.0.1')).status).toBe(401);
    }

    expect((await login('spray_4', 'Summer2026!', '10.2.0.1')).status).toBe(429);
    expect((await login('spray_4', 'Summer2026!', '10.2.0.2')).status).toBe(401);
  });

  it('does not count successful logins', async () => {
    await createUser(ctx.pool, { username: 'shared_ip_user', password: 'correct horse' });
    for (let i = 0; i < 10; i++) {
      expect((await login('shared_ip_user', 'correct horse', '10.2.0.3')).status).toBe(200);
    }

    expect((await login('someone_else', 'wrong guess', '10.2.0.3')).status).toBe(401);
  });
});

describe('per-account cap across IPs (distributed guessing)', () => {
  it('blocks an account guessed from many IPs', async () => {
    await createUser(ctx.pool, { username: 'target', password: 'correct horse' });
    for (let i = 0; i < 6; i++) {
      expect((await login('target', `guess ${i}`, `10.3.0.${i}`)).status).toBe(401);
    }

    const res = await login('TARGET', 'correct horse', '10.3.1.1');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('leaves other accounts usable', async () => {
    await createUser(ctx.pool, { username: 'bystander', password: 'correct horse' });
    for (let i = 0; i < 6; i++) await login('target_2', `guess ${i}`, `10.4.0.${i}`);

    expect((await login('bystander', 'correct horse', '10.4.1.1')).status).toBe(200);
  });

  it('does not count successful logins', async () => {
    await createUser(ctx.pool, { username: 'busy_user', password: 'correct horse' });
    for (let i = 0; i < 10; i++) {
      expect((await login('busy_user', 'correct horse', `10.5.0.${i}`)).status).toBe(200);
    }

    expect((await login('busy_user', 'wrong guess', '10.5.1.1')).status).toBe(401);
  });

  it('holds under concurrent requests from many IPs', async () => {
    await createUser(ctx.pool, { username: 'race_target', password: 'correct horse' });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => login('race_target', `guess ${i}`, `10.6.0.${i}`))
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 401)).toHaveLength(6);
    expect(statuses.filter((s) => s === 429)).toHaveLength(14);
  });
});

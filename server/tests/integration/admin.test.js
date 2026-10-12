import { describe, it, expect } from 'vitest';
import { setupTestApp } from '../helpers/app.js';
import { createUser, countRows } from '../helpers/fixtures.js';
import { resetPassword, generatePassword } from '../../src/auth/admin.js';
import { createSession } from '../../src/auth/sessions.js';

const ctx = setupTestApp();
const login = (username, password) =>
  ctx.request('POST', '/api/auth/login', { body: { username, password } });

describe('resetPassword', () => {
  it('sets the new password, matching the username case-insensitively', async () => {
    await createUser(ctx.pool, { username: 'Alice', password: 'forgotten' });

    const stored = await resetPassword(ctx.pool, 'alice', 'brand new password');

    expect(stored).toBe('Alice');
    expect((await login('alice', 'forgotten')).status).toBe(401);
    expect((await login('alice', 'brand new password')).status).toBe(200);
  });

  it('signs the user out everywhere', async () => {
    const user = await createUser(ctx.pool, { username: 'alice', password: 'forgotten' });
    await createSession(ctx.pool, user.id);
    await createSession(ctx.pool, user.id);

    await resetPassword(ctx.pool, 'alice', 'brand new password');

    expect(await countRows(ctx.pool, 'sessions')).toBe(0);
  });

  it('fails for unknown users', async () => {
    await expect(resetPassword(ctx.pool, 'nobody', 'brand new password'))
      .rejects.toThrow('User "nobody" not found');
  });

  it('enforces the password rules', async () => {
    await createUser(ctx.pool, { username: 'alice' });

    await expect(resetPassword(ctx.pool, 'alice', 'short')).rejects.toThrow('Password must be');
  });
});

describe('generatePassword', () => {
  it('creates random passwords that satisfy the rules', () => {
    const a = generatePassword();
    const b = generatePassword();

    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a).not.toBe(b);
  });
});

import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyAgainstDummy } from '../../src/auth/password.js';

describe('password hashing', () => {
  it('produces argon2id hashes with a random salt', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');

    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
  });

  it('verifies the right password', async () => {
    const hash = await hashPassword('correct horse');

    expect(await verifyPassword(hash, 'correct horse')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse');

    expect(await verifyPassword(hash, 'Correct horse')).toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'anything')).toBe(false);
  });

  it('verifyAgainstDummy always fails', async () => {
    expect(await verifyAgainstDummy('dummy password for timing equalization')).toBe(false);
  });
});

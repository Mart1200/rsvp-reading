import { describe, it, expect } from 'vitest';
import { usernameError, passwordError, assertValid } from '../../src/auth/validation.js';
import { HttpError } from '../../src/errors.js';

describe('usernameError', () => {
  it.each(['abc', 'Alice', 'user_name-01', 'a'.repeat(32)])('accepts %s', (username) => {
    expect(usernameError(username)).toBeNull();
  });

  it.each([
    ['too short', 'ab'],
    ['too long', 'a'.repeat(33)],
    ['space', 'john doe'],
    ['dot', 'john.doe'],
    ['umlaut', 'jürgen'],
    ['empty', ''],
    ['not a string', 123],
    ['missing', undefined]
  ])('rejects %s', (_, username) => {
    expect(usernameError(username)).toMatch(/3–32 characters/);
  });
});

describe('passwordError', () => {
  it.each(['12345678', 'a'.repeat(128), 'pässwörd', '🔑🔑🔑🔑🔑🔑🔑🔑'])('accepts %s', (password) => {
    expect(passwordError(password)).toBeNull();
  });

  it.each([
    ['too short', '1234567'],
    ['too long', 'a'.repeat(129)],
    ['not a string', 12345678],
    ['missing', undefined]
  ])('rejects %s', (_, password) => {
    expect(passwordError(password)).toBe('Password must be 8–128 characters');
  });

  it('counts emoji as one character each', () => {
    expect(passwordError('🔑'.repeat(7))).not.toBeNull();
    expect(passwordError('🔑'.repeat(128))).toBeNull();
  });
});

describe('assertValid', () => {
  it('does nothing without a message', () => {
    expect(() => assertValid(null)).not.toThrow();
  });

  it('throws a 400 VALIDATION error with the message', () => {
    expect(() => assertValid('bad')).toThrow(HttpError);
    try {
      assertValid('bad');
    } catch (error) {
      expect(error).toMatchObject({ status: 400, code: 'VALIDATION', message: 'bad' });
    }
  });
});

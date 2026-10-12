import { describe, it, expect } from 'vitest';
import { HttpError, errorBody } from '../../src/errors.js';

describe('HttpError', () => {
  it('carries status, code and message', () => {
    const error = new HttpError(409, 'USERNAME_TAKEN', 'Username is already taken');
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(409);
    expect(error.code).toBe('USERNAME_TAKEN');
    expect(error.message).toBe('Username is already taken');
  });
});

describe('errorBody', () => {
  it('builds the uniform error format', () => {
    expect(errorBody('VALIDATION', 'Bad input')).toEqual({
      error: { code: 'VALIDATION', message: 'Bad input' }
    });
  });
});

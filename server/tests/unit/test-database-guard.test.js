import { describe, it, expect } from 'vitest';
import { assertTestDatabaseUrl } from '../helpers/db.js';

describe('assertTestDatabaseUrl', () => {
  it('accepts databases ending in _test', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/rsvp_test')).not.toThrow();
  });

  it.each([
    'postgres://u:p@localhost:5432/rsvp',
    'postgres://u:p@localhost:5432/test_rsvp',
    'postgres://u:p@localhost:5432/'
  ])('refuses %s', (url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow('Refusing to run tests');
  });

  it('refuses invalid URLs', () => {
    expect(() => assertTestDatabaseUrl('not a url')).toThrow('not a valid URL');
  });
});

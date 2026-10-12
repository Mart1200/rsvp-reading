import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';

const DATABASE_URL = 'postgres://u:p@localhost/db';

describe('loadConfig', () => {
  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL is required');
  });

  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      port: 3000,
      cookieSecure: true,
      origin: 'http://localhost:5173',
      staticDir: null
    });
  });

  it('reads overrides', () => {
    const config = loadConfig({
      DATABASE_URL,
      PORT: '4000',
      COOKIE_SECURE: 'false',
      ORIGIN: 'https://rsvp.example.com'
    });
    expect(config.port).toBe(4000);
    expect(config.cookieSecure).toBe(false);
    expect(config.origin).toBe('https://rsvp.example.com');
  });

  it('resolves STATIC_DIR to an absolute path', () => {
    const config = loadConfig({ DATABASE_URL, STATIC_DIR: 'public' });
    expect(path.isAbsolute(config.staticDir)).toBe(true);
    expect(config.staticDir).toBe(path.resolve('public'));
  });

  it('keeps cookies secure for any value other than "false"', () => {
    expect(loadConfig({ DATABASE_URL, COOKIE_SECURE: '0' }).cookieSecure).toBe(true);
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects invalid PORT %s', (PORT) => {
    expect(() => loadConfig({ DATABASE_URL, PORT })).toThrow('PORT must be');
  });
});

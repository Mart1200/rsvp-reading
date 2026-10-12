import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';

const DATABASE_URL = 'postgres://u:p@localhost/db';

describe('loadConfig', () => {
  describe('database', () => {
    it('requires DATABASE_URL or PGHOST', () => {
      expect(() => loadConfig({})).toThrow('DATABASE_URL or PGHOST is required');
    });

    it('accepts PG* variables instead of DATABASE_URL', () => {
      const config = loadConfig({ PGHOST: 'db', PGPASSWORD: 'p@ss#1' });
      expect(config.databaseUrl).toBeNull();
    });

    it('uses DATABASE_URL when set', () => {
      expect(loadConfig({ DATABASE_URL }).databaseUrl).toBe(DATABASE_URL);
    });
  });

  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      port: 3000,
      cookieSecure: true,
      origin: 'http://localhost:5173',
      trustProxy: false,
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

  it('enables TRUST_PROXY only for "true"', () => {
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: '1' }).trustProxy).toBe(false);
  });

  it('resolves STATIC_DIR to an absolute path', () => {
    const config = loadConfig({ DATABASE_URL, STATIC_DIR: 'public' });
    expect(path.isAbsolute(config.staticDir)).toBe(true);
    expect(config.staticDir).toBe(path.resolve('public'));
  });

  it.each(['0', 'true', '', 'FALSE'])('keeps cookies secure for COOKIE_SECURE=%j', (COOKIE_SECURE) => {
    expect(loadConfig({ DATABASE_URL, COOKIE_SECURE }).cookieSecure).toBe(true);
  });

  it.each(['abc', '0', '70000', '3.5'])('rejects invalid PORT %s', (PORT) => {
    expect(() => loadConfig({ DATABASE_URL, PORT })).toThrow('PORT must be');
  });

  describe('ORIGIN', () => {
    it('is required in production', () => {
      expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production' }))
        .toThrow('ORIGIN is required in production');
    });

    it('is accepted in production when set', () => {
      const config = loadConfig({ DATABASE_URL, NODE_ENV: 'production', ORIGIN: 'https://rsvp.example.com' });
      expect(config.origin).toBe('https://rsvp.example.com');
    });

    it.each([
      ['https://rsvp.example.com/', 'https://rsvp.example.com'],
      ['HTTPS://RSVP.Example.com', 'https://rsvp.example.com'],
      ['http://localhost:8080', 'http://localhost:8080']
    ])('normalizes %s to %s', (ORIGIN, expected) => {
      expect(loadConfig({ DATABASE_URL, ORIGIN }).origin).toBe(expected);
    });

    it.each([
      'rsvp.example.com',
      'https://rsvp.example.com/app',
      'https://rsvp.example.com?x=1',
      'ftp://rsvp.example.com'
    ])('rejects %s', (ORIGIN) => {
      expect(() => loadConfig({ DATABASE_URL, ORIGIN })).toThrow('ORIGIN must be');
    });
  });
});

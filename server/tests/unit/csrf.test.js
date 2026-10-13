import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { request, TEST_ORIGIN } from '../helpers/app.js';

// POST /api/auth/logout without a cookie touches no database, so a fake pool suffices
const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
const app = createApp({ pool, origin: TEST_ORIGIN });

describe('CSRF protection', () => {
  it('allows same-origin JSON requests', async () => {
    const res = await request(app, 'POST', '/api/auth/logout', { body: {} });

    expect(res.status).toBe(204);
  });

  it('accepts a charset in the JSON content type', async () => {
    const res = await request(app, 'POST', '/api/auth/logout', {
      body: {},
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

    expect(res.status).toBe(204);
  });

  it.each([
    ['a foreign origin', 'https://evil.example'],
    ['a different port', 'http://localhost:5174'],
    ['the "null" origin', 'null'],
    ['no Origin header', null]
  ])('blocks requests from %s', async (_, origin) => {
    const res = await request(app, 'POST', '/api/auth/logout', {
      body: {},
      headers: { Origin: origin }
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'CSRF', message: 'Cross-origin request blocked' } });
  });

  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    'application/jsonp',
    null
  ])('rejects Content-Type %s with 415', async (contentType) => {
    const res = await request(app, 'POST', '/api/auth/logout', {
      body: '{}',
      headers: { 'Content-Type': contentType }
    });

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  describe('beacon routes', () => {
    const progressPath = '/api/texts/00000000-0000-4000-8000-000000000000/progress';

    it('lets text/plain through for POST progress (reaches the auth check)', async () => {
      const res = await request(app, 'POST', progressPath, {
        body: '{"currentWordIndex":1}',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });

      expect(res.status).toBe(401);
    });

    it('still requires the origin', async () => {
      const res = await request(app, 'POST', progressPath, {
        body: '{"currentWordIndex":1}',
        headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }
      });

      expect(res.status).toBe(403);
    });

    it.each([
      ['PUT on the same path', 'PUT', progressPath],
      ['POST on another path', 'POST', '/api/texts']
    ])('rejects text/plain for %s', async (_, method, path) => {
      const res = await request(app, method, path, {
        body: '{}',
        headers: { 'Content-Type': 'text/plain' }
      });

      expect(res.status).toBe(415);
    });
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('also checks %s requests', async (method) => {
    const res = await request(app, method, '/api/anything', {
      body: {},
      headers: { Origin: 'https://evil.example' }
    });

    expect(res.status).toBe(403);
  });

  it('does not check safe methods', async () => {
    const res = await request(app, 'GET', '/api/health', { headers: { Origin: 'https://evil.example' } });

    expect(res.status).toBe(200);
  });
});

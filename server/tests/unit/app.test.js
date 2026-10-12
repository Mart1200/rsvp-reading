import { describe, it, expect, vi } from 'vitest';
import { createApp, withTimeout, MAX_BODY_BYTES } from '../../src/app.js';
import { HttpError } from '../../src/errors.js';
import { request } from '../helpers/app.js';

// Unit tests use a fake pool; see tests/integration for tests against Postgres
const healthyPool = () => ({ query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) });
const brokenPool = () => ({ query: vi.fn().mockRejectedValue(new Error('connection refused')) });

describe('GET /api/health', () => {
  it('pings the database and returns ok', async () => {
    const pool = healthyPool();
    const res = await request(createApp({ pool }), 'GET', '/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database is unreachable', async () => {
    const res = await request(createApp({ pool: brokenPool() }), 'GET', '/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'DB_UNAVAILABLE', message: 'Database is not reachable' }
    });
  });

  it('returns 503 instead of hanging when the database does not answer', async () => {
    const hangingPool = { query: vi.fn(() => new Promise(() => {})) };
    const app = createApp({ pool: hangingPool, healthTimeoutMs: 20 });

    const res = await request(app, 'GET', '/api/health');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DB_UNAVAILABLE');
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise is fast enough', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('passes through rejections', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });

  it('rejects when the promise takes too long', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow('Timed out after 10 ms');
  });

  it('clears its timer once settled', async () => {
    vi.useFakeTimers();
    try {
      await withTimeout(Promise.resolve('ok'), 1000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('error handling', () => {
  it('returns 404 in the error format for unknown routes', async () => {
    const res = await request(createApp({ pool: healthyPool() }), 'GET', '/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('maps a thrown HttpError to its status and code', async () => {
    const app = createApp({ pool: healthyPool() });
    app.get('/api/teapot', () => {
      throw new HttpError(418, 'TEAPOT', 'I am a teapot');
    });

    const res = await request(app, 'GET', '/api/teapot');

    expect(res.status).toBe(418);
    expect(res.body).toEqual({ error: { code: 'TEAPOT', message: 'I am a teapot' } });
  });

  it('returns 500 without leaking details for unexpected errors', async () => {
    const app = createApp({ pool: healthyPool() });
    app.get('/api/boom', () => {
      throw new Error('secret internals');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app, 'GET', '/api/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(JSON.stringify(res.body)).not.toContain('secret internals');
    consoleError.mockRestore();
  });
});

describe('body limit', () => {
  const echoApp = () => {
    const app = createApp({ pool: healthyPool() });
    app.post('/api/echo', async (c) => c.json({ length: (await c.req.text()).length }));
    return app;
  };

  it('accepts bodies up to 20 MB', async () => {
    const res = await request(echoApp(), 'POST', '/api/echo', { body: 'x'.repeat(MAX_BODY_BYTES) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ length: MAX_BODY_BYTES });
  });

  it('rejects bodies larger than 20 MB with 413', async () => {
    const res = await request(echoApp(), 'POST', '/api/echo', { body: 'x'.repeat(MAX_BODY_BYTES + 1) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 20 MB' }
    });
  });
});

describe('reverse proxy warning', () => {
  const forwarded = { headers: { 'X-Forwarded-For': '1.2.3.4' } };

  it('warns once when X-Forwarded-For arrives without TRUST_PROXY', async () => {
    const logger = { warn: vi.fn() };
    const app = createApp({ pool: healthyPool(), logger });

    await app.request('/api/health', forwarded);
    await app.request('/api/health', forwarded);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('TRUST_PROXY');
  });

  it('stays quiet without the header', async () => {
    const logger = { warn: vi.fn() };
    const app = createApp({ pool: healthyPool(), logger });

    await app.request('/api/health');

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stays quiet when TRUST_PROXY is enabled', async () => {
    const logger = { warn: vi.fn() };
    const app = createApp({ pool: healthyPool(), logger, trustProxy: true });

    await app.request('/api/health', forwarded);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { isApiPath, cacheControlFor } from '../../src/static.js';
import { request } from '../helpers/app.js';

const STATIC_DIR = fileURLToPath(new URL('../fixtures/static/', import.meta.url));
const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
const app = createApp({ pool, staticDir: STATIC_DIR });

describe('isApiPath', () => {
  it.each([
    ['/api', true],
    ['/api/', true],
    ['/api/health', true],
    ['/apiary', false],
    ['/', false],
    ['/assets/api.js', false]
  ])('%s -> %s', (path, expected) => {
    expect(isApiPath(path)).toBe(expected);
  });
});

describe('cacheControlFor', () => {
  it('caches hashed Vite assets forever', () => {
    expect(cacheControlFor('/assets/app-abc123.js')).toBe('public, max-age=31536000, immutable');
  });

  it.each(['/index.html', '/sw.js', '/manifest.json', '/favicon.svg'])(
    'revalidates %s',
    (path) => expect(cacheControlFor(path)).toBe('no-cache')
  );
});

describe('serving the frontend', () => {
  it('serves index.html at /', async () => {
    const res = await request(app, 'GET', '/');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.body).toContain('<div id="app">');
  });

  it('serves hashed assets with long-term caching', async () => {
    const res = await request(app, 'GET', '/assets/app-abc123.js');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.body).toContain('fixture bundle');
  });

  it('serves root files such as the service worker without long-term caching', async () => {
    const res = await request(app, 'GET', '/sw.js');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await request(app, 'GET', '/library/some-id');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.body).toContain('<div id="app">');
  });

  it('falls back to index.html (not immutable) for extensionless paths under /assets', async () => {
    const res = await request(app, 'GET', '/assets/missing');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns a JSON 404 for missing files with an extension', async () => {
    const res = await request(app, 'GET', '/assets/missing.js');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('answers HEAD requests', async () => {
    const res = await app.request('/', { method: 'HEAD' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('does not serve the frontend for non-GET requests', async () => {
    const res = await request(app, 'POST', '/library', { body: {} });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('blocks path traversal outside the static directory', async () => {
    const res = await app.request('/..%2f..%2fpackage.json');

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('rsvp-server');
  });
});

describe('API routes alongside the frontend', () => {
  it('keeps serving API routes', async () => {
    const res = await request(app, 'GET', '/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it.each(['/api/does-not-exist', '/api'])(
    'returns a JSON 404 instead of index.html for %s',
    async (path) => {
      const res = await request(app, 'GET', path);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    }
  );
});

describe('without a static directory', () => {
  it('serves the API only', async () => {
    const apiOnly = createApp({ pool });

    expect((await request(apiOnly, 'GET', '/')).status).toBe(404);
    expect((await request(apiOnly, 'GET', '/api/health')).status).toBe(200);
  });
});

describe('compression', () => {
  it('gzips responses when the client accepts it', async () => {
    const big = createApp({ pool });
    big.get('/api/big', (c) => c.json({ data: 'x'.repeat(5000) }));

    const res = await big.request('/api/big', { headers: { 'Accept-Encoding': 'gzip' } });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('does not compress when the client does not accept it', async () => {
    const big = createApp({ pool });
    big.get('/api/big', (c) => c.json({ data: 'x'.repeat(5000) }));

    const res = await big.request('/api/big');

    expect(res.headers.get('content-encoding')).toBeNull();
  });
});

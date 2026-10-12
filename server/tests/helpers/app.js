import { beforeAll, afterEach, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestPool, truncateAll } from './db.js';

/**
 * Register hooks that provide an app backed by the test database.
 * Data is truncated after every test so tests stay independent.
 *
 * @example
 * const ctx = setupTestApp();
 * it('works', async () => {
 *   const res = await ctx.request('GET', '/api/health');
 *   expect(res.status).toBe(200);
 * });
 *
 * @returns {{ app: import('hono').Hono, pool: import('pg').Pool, request: typeof request }}
 *   Context object; fields are populated in beforeAll
 */
export function setupTestApp() {
  const ctx = {};

  beforeAll(() => {
    ctx.pool = createTestPool();
    ctx.app = createApp({ pool: ctx.pool });
    ctx.request = (method, path, options) => request(ctx.app, method, path, options);
  });

  afterEach(async () => {
    await truncateAll(ctx.pool);
  });

  afterAll(async () => {
    await ctx.pool.end();
  });

  return ctx;
}

/**
 * Send a request to the app and parse the JSON response
 * @param {import('hono').Hono} app
 * @param {string} method - HTTP method
 * @param {string} path - Request path, e.g. "/api/health"
 * @param {Object} [options]
 * @param {*} [options.body] - Serialized as JSON unless it is already a string
 * @param {Object} [options.headers] - Extra request headers (e.g. Cookie, Origin)
 * @returns {Promise<{status: number, headers: Headers, body: *}>}
 */
export async function request(app, method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] ??= 'application/json';
  }

  const res = await app.request(path, init);
  const text = await res.text();
  let parsed = text;
  if (res.headers.get('content-type')?.includes('application/json')) {
    parsed = JSON.parse(text);
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

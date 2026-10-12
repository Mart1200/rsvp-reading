import { beforeAll, afterEach, afterAll } from 'vitest';
import { createApp } from '../../src/app.js';
import { createSession, SESSION_COOKIE } from '../../src/auth/sessions.js';
import { createTestPool, truncateAll } from './db.js';
import { createUser } from './fixtures.js';

export const TEST_ORIGIN = 'http://localhost:5173';

// High enough that ordinary tests never hit them; rate-limit tests pass their own
export const RELAXED_RATE_LIMITS = {
  login: { limit: 1000, windowMs: 60_000 },
  loginIp: { limit: 1000, windowMs: 60_000 },
  loginAccount: { limit: 1000, windowMs: 60_000 },
  register: { limit: 1000, windowMs: 60_000 },
  password: { limit: 1000, windowMs: 60_000 }
};

/**
 * Register hooks that provide an app backed by the test database.
 * Data is truncated after every test so tests stay independent.
 *
 * @example
 * const ctx = setupTestApp();
 * it('works', async () => {
 *   const { cookie } = await ctx.loggedInUser();
 *   const res = await ctx.request('GET', '/api/auth/me', { cookie });
 *   expect(res.status).toBe(200);
 * });
 *
 * @param {Object} [appOptions] - Extra createApp options, e.g. { rateLimits }
 * @returns {{
 *   app: import('hono').Hono,
 *   pool: import('pg').Pool,
 *   request: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>,
 *   loggedInUser: (overrides?: Object) => Promise<{user: Object, password: string, cookie: string}>
 * }} Context object; fields are populated in beforeAll
 */
export function setupTestApp(appOptions = {}) {
  const ctx = {};

  beforeAll(() => {
    ctx.pool = createTestPool();
    ctx.app = createApp({
      pool: ctx.pool,
      origin: TEST_ORIGIN,
      cookieSecure: false,
      rateLimits: RELAXED_RATE_LIMITS,
      ...appOptions
    });
    ctx.request = (method, path, options) => request(ctx.app, method, path, options);
    ctx.loggedInUser = (overrides) => loggedInUser(ctx.pool, overrides);
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
 * Create a user with a real password hash plus a session, without going through the API
 * @param {import('pg').Pool} pool
 * @param {Object} [overrides] - createUser overrides; `password` defaults to "correct horse"
 * @returns {Promise<{user: Object, password: string, cookie: string, token: string}>}
 */
export async function loggedInUser(pool, overrides = {}) {
  const password = overrides.password ?? 'correct horse';
  const user = await createUser(pool, { ...overrides, password });
  const { token } = await createSession(pool, user.id);
  return { user, password, token, cookie: `${SESSION_COOKIE}=${token}` };
}

/**
 * @typedef {Object} RequestOptions
 * @property {*} [body] - Serialized as JSON unless it is already a string
 * @property {string} [cookie] - Cookie header, e.g. from loggedInUser() or sessionCookie()
 * @property {Object} [headers] - Extra headers; set Origin or Content-Type to null to omit them
 */

/**
 * @typedef {Object} TestResponse
 * @property {number} status
 * @property {Headers} headers
 * @property {*} body - Parsed JSON, text, or "" for empty responses
 */

/**
 * Send a request to the app like the frontend would (same origin, JSON body)
 * @param {import('hono').Hono} app
 * @param {string} method - HTTP method
 * @param {string} path - Request path, e.g. "/api/health"
 * @param {RequestOptions} [options]
 * @returns {Promise<TestResponse>}
 */
export async function request(app, method, path, { body, cookie, headers = {} } = {}) {
  const defaults = {};
  if (!['GET', 'HEAD'].includes(method)) defaults.Origin = TEST_ORIGIN;
  if (body !== undefined) defaults['Content-Type'] = 'application/json';
  if (cookie) defaults.Cookie = cookie;

  // Explicit null removes a default header
  const merged = Object.fromEntries(
    Object.entries({ ...defaults, ...headers }).filter(([, value]) => value !== null)
  );

  const init = { method, headers: merged };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);

  const res = await app.request(path, init);
  const text = await res.text();
  let parsed = text;
  if (res.headers.get('content-type')?.includes('application/json')) {
    parsed = JSON.parse(text);
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

/**
 * Extract the session cookie from a response as a Cookie header value
 * @param {TestResponse} res
 * @returns {string|null} e.g. "sid=abc", or null if the response sets none
 */
export function sessionCookie(res) {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!header) return null;
  const pair = header.split(';')[0];
  return pair === `${SESSION_COOKIE}=` ? null : pair;
}

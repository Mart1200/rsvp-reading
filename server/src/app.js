import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { HttpError, errorBody } from './errors.js';
import { serveFrontend } from './static.js';
import { csrfProtection } from './csrf.js';
import { getClientIp } from './request.js';
import { createRateLimiter } from './auth/rate-limit.js';
import { sessionMiddleware } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';

export const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const HEALTH_TIMEOUT_MS = 2000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Rate limits from the auth spec; tests may override them */
export const DEFAULT_RATE_LIMITS = {
  login: { limit: 5, windowMs: MINUTE },
  register: { limit: 10, windowMs: HOUR },
  password: { limit: 5, windowMs: MINUTE }
};

/**
 * Reject if the promise does not settle in time
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Create the HTTP application
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool - Postgres connection pool
 * @param {string} [deps.origin] - Origin allowed to send mutating requests
 * @param {boolean} [deps.cookieSecure] - Set the Secure flag on the session cookie
 * @param {boolean} [deps.trustProxy] - Take the client IP from X-Forwarded-For
 * @param {string|null} [deps.staticDir] - Frontend build to serve; null serves the API only
 * @param {number} [deps.healthTimeoutMs] - Max time the health check waits for the database
 * @param {Partial<typeof DEFAULT_RATE_LIMITS>} [deps.rateLimits] - Overrides per limiter
 * @returns {Hono}
 */
export function createApp({
  pool,
  origin = 'http://localhost:5173',
  cookieSecure = true,
  trustProxy = false,
  staticDir = null,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  rateLimits = {}
}) {
  const app = new Hono();
  const limiters = Object.fromEntries(
    Object.entries({ ...DEFAULT_RATE_LIMITS, ...rateLimits })
      .map(([name, options]) => [name, createRateLimiter(options)])
  );

  app.use('*', compress());

  app.use('/api/*', bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json(errorBody('PAYLOAD_TOO_LARGE', 'Request body exceeds 20 MB'), 413)
  }));

  app.get('/api/health', async (c) => {
    try {
      await withTimeout(pool.query('SELECT 1'), healthTimeoutMs);
    } catch {
      throw new HttpError(503, 'DB_UNAVAILABLE', 'Database is not reachable');
    }
    return c.json({ ok: true });
  });

  app.use('/api/*', csrfProtection(origin));
  app.use('/api/*', sessionMiddleware({ pool, cookieSecure }));

  app.route('/api/auth', authRoutes({
    pool,
    cookieSecure,
    getIp: (c) => getClientIp(c, trustProxy),
    limiters
  }));

  // Registered last; skips /api/* so API routes always win
  if (staticDir) serveFrontend(app, staticDir);

  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Route not found'), 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(errorBody(err.code, err.message), err.status, err.headers);
    }
    console.error('Unhandled error:', err);
    return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500);
  });

  return app;
}

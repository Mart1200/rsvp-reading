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
import { textRoutes } from './routes/texts.js';

export const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const HEALTH_TIMEOUT_MS = 2000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Rate limits for auth endpoints; tests may override them */
export const DEFAULT_RATE_LIMITS = {
  // Failed logins per IP + username
  login: { limit: 5, windowMs: MINUTE },
  // Failed logins per IP across usernames (password spraying)
  loginIp: { limit: 30, windowMs: 15 * MINUTE },
  // Failed logins per username across IPs (distributed guessing). A hard limit on purpose:
  // locking someone out takes sustained effort, unlimited guessing would be worse.
  loginAccount: { limit: 50, windowMs: 15 * MINUTE },
  // Registrations per IP
  register: { limit: 10, windowMs: HOUR },
  // Wrong current passwords per user (password change, account deletion)
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
 * @param {{warn: (...args: any[]) => void}} [deps.logger] - For configuration warnings
 * @returns {Hono}
 */
export function createApp({
  pool,
  origin = 'http://localhost:5173',
  cookieSecure = true,
  trustProxy = false,
  staticDir = null,
  healthTimeoutMs = HEALTH_TIMEOUT_MS,
  rateLimits = {},
  logger = console
}) {
  const app = new Hono();
  const limiters = Object.fromEntries(
    Object.entries({ ...DEFAULT_RATE_LIMITS, ...rateLimits })
      .map(([name, options]) => [name, createRateLimiter(options)])
  );

  app.use('*', compress());

  if (!trustProxy) {
    let warned = false;
    app.use('*', async (c, next) => {
      if (!warned && c.req.header('x-forwarded-for')) {
        warned = true;
        logger.warn(
          'Received X-Forwarded-For but TRUST_PROXY is not enabled. Behind a reverse proxy all ' +
          'clients share the proxy IP, so login and registration rate limits hit everyone at once. ' +
          'Set TRUST_PROXY=true if the app is only reachable through the proxy.'
        );
      }
      await next();
    });
  }

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
  app.route('/api/texts', textRoutes({ pool }));

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

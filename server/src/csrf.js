import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for mutating requests:
 * - the Origin header must match the configured origin exactly
 * - the body must be JSON, which cross-site HTML forms cannot send
 * @param {string} origin - Allowed origin, e.g. "https://rsvp.example.com"
 * @returns {import('hono').MiddlewareHandler}
 */
export function csrfProtection(origin) {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    if (c.req.header('origin') !== origin) {
      throw new HttpError(403, 'CSRF', 'Cross-origin request blocked');
    }
    const contentType = c.req.header('content-type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }
    return next();
  };
}

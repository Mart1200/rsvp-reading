import { HttpError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * POST routes that also accept a text/plain body, because navigator.sendBeacon cannot send
 * JSON as a simple request. The Origin check still applies; the body must still be JSON.
 */
export const BEACON_PATHS = [/^\/api\/texts\/[^/]+\/progress$/, /^\/api\/auth\/settings$/];

/**
 * CSRF protection for mutating requests:
 * - the Origin header must match the configured origin exactly
 * - the body must be JSON, which cross-site HTML forms cannot send
 *   (except for BEACON_PATHS, which rely on the Origin check alone)
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
    const beacon = c.req.method === 'POST' && BEACON_PATHS.some((path) => path.test(c.req.path));
    const allowed = beacon ? /^(application\/json|text\/plain)\s*(;|$)/i : /^application\/json\s*(;|$)/i;
    if (!allowed.test(contentType)) {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }
    return next();
  };
}

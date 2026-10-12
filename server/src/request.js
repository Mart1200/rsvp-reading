import { getConnInfo } from '@hono/node-server/conninfo';
import { HttpError } from './errors.js';

/**
 * Parse the request body as a JSON object
 * @param {import('hono').Context} c
 * @returns {Promise<Object>}
 */
export async function readJsonObject(c) {
  let body;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION', 'Request body must be a JSON object');
  }
  return body;
}

/**
 * Client IP for rate limiting.
 * Behind a reverse proxy (TRUST_PROXY=true) the proxy appends the real client
 * address as the last X-Forwarded-For entry; earlier entries are client-controlled.
 * @param {import('hono').Context} c
 * @param {boolean} trustProxy
 * @returns {string}
 */
export function getClientIp(c, trustProxy) {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
    if (forwarded?.length) return forwarded[forwarded.length - 1];
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // No socket, e.g. app.request() in tests
    return 'unknown';
  }
}

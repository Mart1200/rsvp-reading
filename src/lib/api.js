/**
 * Minimal client for the backend API (same origin, JSON, session cookie)
 */

export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status, 0 when the server could not be reached
   * @param {string} code - Error code from the API, e.g. "INVALID_CREDENTIALS"
   * @param {string} message - Human-readable message
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let unauthenticatedHandler = null;

/**
 * Register a callback for responses saying the session is gone
 * (expired, or revoked by a password change or admin reset on another device)
 * @param {(() => void)|null} handler
 */
export function onUnauthenticated(handler) {
  unauthenticatedHandler = handler;
}

/**
 * Call an API endpoint
 * @param {string} path - e.g. "/api/auth/me"
 * @param {Object} [options]
 * @param {string} [options.method] - HTTP method (default GET)
 * @param {Object} [options.body] - JSON body; mutating requests always send one
 * @returns {Promise<any>} Parsed JSON, or null for 204 responses
 * @throws {ApiError}
 */
export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') {
    // The server requires a JSON content type on mutating requests (CSRF protection)
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response, e.g. a proxy error page
  }

  if (!res.ok) {
    // Only a missing session, not e.g. wrong credentials at login (INVALID_CREDENTIALS)
    if (res.status === 401 && data?.error?.code === 'UNAUTHENTICATED') unauthenticatedHandler?.();
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'HTTP_ERROR',
      data?.error?.message ?? `Request failed (${res.status})`
    );
  }
  return data;
}

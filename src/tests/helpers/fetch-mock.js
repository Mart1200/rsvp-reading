import { vi } from 'vitest';

/**
 * Replace global fetch with a route table.
 *
 * @example
 * const server = mockFetch({
 *   'GET /api/auth/me': { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } } },
 *   'POST /api/auth/login': (req) => ({ status: 200, body: { user: { username: req.body.username } } })
 * });
 * expect(server.calls('POST /api/auth/login')[0].body).toEqual({ ... });
 *
 * @param {Record<string, {status?: number, body?: any} | ((req: {method: string, path: string, body: any, init: RequestInit}) => {status?: number, body?: any})>} routes
 *   Unmatched requests answer 404 in the API error format.
 * @returns {{
 *   fetch: import('vitest').Mock,
 *   calls: (route: string) => Array<{method: string, path: string, body: any, init: RequestInit}>,
 *   route: (key: string, handler: any) => void
 * }}
 */
export function mockFetch(routes = {}) {
  const table = { ...routes };
  const requests = [];

  const fetch = vi.fn(async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const req = { method, path, body, init };
    requests.push(req);

    const handler = table[`${method} ${path}`];
    const { status = 200, body: resBody } = typeof handler === 'function'
      ? await handler(req)
      : handler ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Route not found' } } };

    return new Response(status === 204 || resBody === undefined ? null : JSON.stringify(resBody), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  vi.stubGlobal('fetch', fetch);

  return {
    fetch,
    calls: (route) => requests.filter((r) => `${r.method} ${r.path}` === route),
    route: (key, handler) => { table[key] = handler; }
  };
}

/** Error response body in the API format */
export function apiError(code, message = code) {
  return { error: { code, message } };
}

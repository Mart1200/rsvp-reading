import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, onUnauthenticated } from '../lib/api.js';
import { mockFetch, apiError } from './helpers/fetch-mock.js';

afterEach(() => {
  vi.unstubAllGlobals();
  onUnauthenticated(null);
});

describe('api', () => {
  it('returns parsed JSON for GET requests without a body', async () => {
    const server = mockFetch({ 'GET /api/thing': { body: { ok: true } } });

    expect(await api('/api/thing')).toEqual({ ok: true });
    const { init } = server.calls('GET /api/thing')[0];
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('same-origin');
  });

  it('sends JSON with a JSON content type on mutating requests', async () => {
    const server = mockFetch({ 'POST /api/thing': { body: { ok: true } } });

    await api('/api/thing', { method: 'POST', body: { a: 1 } });

    const { init, body } = server.calls('POST /api/thing')[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(body).toEqual({ a: 1 });
  });

  it('sends an empty JSON object when a mutating request has no body', async () => {
    const server = mockFetch({ 'POST /api/auth/logout': { status: 204 } });

    await api('/api/auth/logout', { method: 'POST' });

    expect(server.calls('POST /api/auth/logout')[0].body).toEqual({});
  });

  it('returns null for 204 responses', async () => {
    mockFetch({ 'DELETE /api/thing': { status: 204 } });

    expect(await api('/api/thing', { method: 'DELETE' })).toBeNull();
  });

  it('throws ApiError with status, code and message from the error body', async () => {
    mockFetch({ 'POST /api/auth/login': { status: 401, body: apiError('INVALID_CREDENTIALS', 'Wrong username or password') } });

    const error = await api('/api/auth/login', { method: 'POST', body: {} }).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Wrong username or password' });
  });

  it('handles non-JSON error responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Bad Gateway</h1>', { status: 502 })));

    const error = await api('/api/thing').catch((e) => e);

    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR', message: 'Request failed (502)' });
  });

  it('notifies the unauthenticated handler when the session is gone', async () => {
    const handler = vi.fn();
    onUnauthenticated(handler);
    mockFetch({ 'GET /api/thing': { status: 401, body: apiError('UNAUTHENTICATED', 'Not logged in') } });

    await expect(api('/api/thing')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not treat wrong login credentials as a lost session', async () => {
    const handler = vi.fn();
    onUnauthenticated(handler);
    mockFetch({ 'POST /api/auth/login': { status: 401, body: apiError('INVALID_CREDENTIALS') } });

    await expect(api('/api/auth/login', { method: 'POST' })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('turns network failures into status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    const error = await api('/api/thing').catch((e) => e);

    expect(error).toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { getClientIp, readJsonObject } from '../../src/request.js';
import { HttpError, errorBody } from '../../src/errors.js';

function ipApp(trustProxy) {
  const app = new Hono();
  app.get('/ip', (c) => c.text(getClientIp(c, trustProxy)));
  return app;
}

describe('getClientIp', () => {
  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    const res = await ipApp(false).request('/ip', { headers: { 'X-Forwarded-For': '1.2.3.4' } });

    // app.request() has no socket, so the fallback applies
    expect(await res.text()).toBe('unknown');
  });

  it('uses the last X-Forwarded-For entry behind a trusted proxy', async () => {
    // The first entry is client-controlled; the proxy appends the real address
    const res = await ipApp(true).request('/ip', {
      headers: { 'X-Forwarded-For': '6.6.6.6, 1.2.3.4' }
    });

    expect(await res.text()).toBe('1.2.3.4');
  });

  it('trims whitespace and skips empty entries', async () => {
    const res = await ipApp(true).request('/ip', { headers: { 'X-Forwarded-For': ' 1.2.3.4 , ' } });

    expect(await res.text()).toBe('1.2.3.4');
  });

  it('falls back to the socket address without the header', async () => {
    const res = await ipApp(true).request('/ip');

    expect(await res.text()).toBe('unknown');
  });
});

describe('readJsonObject', () => {
  const app = new Hono();
  app.post('/echo', async (c) => c.json(await readJsonObject(c)));
  app.onError((err, c) => c.json(errorBody(err.code, err.message), err instanceof HttpError ? err.status : 500));

  const post = (body) => app.request('/echo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  it('returns the parsed object', async () => {
    const res = await post('{"a":1}');

    expect(await res.json()).toEqual({ a: 1 });
  });

  it('rejects invalid JSON', async () => {
    const res = await post('{nope');

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  it.each(['[]', 'null', '"text"', '42'])('rejects non-object JSON %s', async (body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });
});

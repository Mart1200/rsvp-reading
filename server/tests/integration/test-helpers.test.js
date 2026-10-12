import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app.js';
import { setupTestApp, request } from '../helpers/app.js';
import { truncateAll } from '../helpers/db.js';
import { createUser, createText, countRows } from '../helpers/fixtures.js';

// Guards the shared test infrastructure that future tests rely on
const ctx = setupTestApp();

describe('truncateAll', () => {
  it('empties data tables but keeps the migration history', async () => {
    const user = await createUser(ctx.pool);
    await createText(ctx.pool, user.id);

    await truncateAll(ctx.pool);

    expect(await countRows(ctx.pool, 'users')).toBe(0);
    expect(await countRows(ctx.pool, 'texts')).toBe(0);
    expect(await countRows(ctx.pool, 'schema_migrations')).toBeGreaterThan(0);
  });
});

describe('setupTestApp isolation', () => {
  it('creates a row in one test', async () => {
    await createUser(ctx.pool, { username: 'isolation_check' });
    expect(await countRows(ctx.pool, 'users')).toBe(1);
  });

  it('does not see rows from the previous test', async () => {
    expect(await countRows(ctx.pool, 'users')).toBe(0);
  });
});

describe('request helper', () => {
  it('parses JSON responses', async () => {
    const res = await ctx.request('GET', '/api/health');

    expect(res.body).toEqual({ ok: true });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('serializes object bodies as JSON', async () => {
    // Routes can't be added to ctx.app after its first request, so use a fresh app
    const app = createApp({ pool: ctx.pool });
    app.post('/api/__echo', async (c) => c.json({
      contentType: c.req.header('content-type'),
      body: await c.req.json()
    }));

    const res = await request(app, 'POST', '/api/__echo', { body: { a: 1 } });

    expect(res.body).toEqual({ contentType: 'application/json', body: { a: 1 } });
  });
});

import { describe, it, expect } from 'vitest';
import { setupTestApp } from '../helpers/app.js';

const ctx = setupTestApp();

describe('GET /api/health (real database)', () => {
  it('returns ok', async () => {
    const res = await ctx.request('GET', '/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

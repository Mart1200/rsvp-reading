import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPool, CONNECTION_TIMEOUT_MS } from '../../src/db.js';

let pool;

afterEach(async () => {
  await pool?.end();
});

describe('createPool', () => {
  it('survives idle client errors instead of crashing the process', () => {
    const log = vi.fn();
    pool = createPool({ databaseUrl: 'postgres://u:p@localhost/db' }, { log });

    // Without a listener, emitting 'error' would throw
    expect(() => pool.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(log).toHaveBeenCalledWith('Idle Postgres client error:', 'terminating connection');
  });

  it('sets a connection timeout so requests cannot hang forever', () => {
    pool = createPool({ databaseUrl: 'postgres://u:p@localhost/db' });

    expect(pool.options.connectionTimeoutMillis).toBe(CONNECTION_TIMEOUT_MS);
  });

  it('leaves the connection string unset so pg falls back to PG* variables', () => {
    pool = createPool({ databaseUrl: null });

    expect(pool.options.connectionString).toBeUndefined();
  });
});

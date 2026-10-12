import { describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/migrate.js';

// Failure modes that are hard to provoke with a real database (dropped connections)
const fixtureDir = (name) => new URL(`../fixtures/migrations/${name}/`, import.meta.url);
const quiet = { log: () => {} };

/**
 * Fake pool whose client answers every query with no rows,
 * except where `fail(sql)` returns an error to reject with.
 */
function fakePool(fail = () => null) {
  const client = {
    query: vi.fn(async (sql) => {
      const error = fail(typeof sql === 'string' ? sql : sql.text);
      if (error) throw error;
      return { rows: [] };
    }),
    release: vi.fn()
  };
  return { client, pool: { connect: vi.fn().mockResolvedValue(client) } };
}

describe('runMigrations failure handling', () => {
  it('releases a healthy client for reuse', async () => {
    const { pool, client } = fakePool();

    await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });

    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('keeps the migration error when ROLLBACK also fails and destroys the client', async () => {
    const connectionLost = new Error('Connection terminated');
    const { pool, client } = fakePool((sql) => {
      if (sql.includes('table_that_does_not_exist')) return connectionLost;
      if (sql === 'ROLLBACK') return connectionLost;
      return null;
    });

    await expect(runMigrations(pool, { ...quiet, dir: fixtureDir('failing') }))
      .rejects.toThrow('Migration 002_broken.sql failed: Connection terminated');

    expect(client.release).toHaveBeenCalledWith(connectionLost);
    // No further queries on the broken connection
    expect(client.query).not.toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', expect.anything());
  });

  it('reports the migration error and reuses the client when ROLLBACK succeeds', async () => {
    const { pool, client } = fakePool((sql) =>
      sql.includes('table_that_does_not_exist') ? new Error('relation does not exist') : null
    );

    await expect(runMigrations(pool, { ...quiet, dir: fixtureDir('failing') }))
      .rejects.toThrow('Migration 002_broken.sql failed: relation does not exist');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('destroys the client when unlocking fails', async () => {
    const unlockFailed = new Error('Connection terminated');
    const { pool, client } = fakePool((sql) =>
      sql.includes('pg_advisory_unlock') ? unlockFailed : null
    );

    await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });

    expect(client.release).toHaveBeenCalledWith(unlockFailed);
  });
});

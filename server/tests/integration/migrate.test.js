import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdir } from 'node:fs/promises';
import { runMigrations, MIGRATIONS_DIR } from '../../src/migrate.js';
import { createIsolatedPool, dropSchema } from '../helpers/db.js';

// Each test runs in its own empty schema so the shared public schema stays untouched
const SCHEMA = 'migrate_test';
const fixtureDir = (name) => new URL(`../fixtures/migrations/${name}/`, import.meta.url);
const quiet = { log: () => {} };

let pool;

beforeEach(async () => {
  pool = await createIsolatedPool(SCHEMA);
});

afterEach(async () => {
  await pool.end();
  await dropSchema(SCHEMA);
});

async function tableNames() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`
  );
  return rows.map((r) => r.tablename);
}

async function appliedMigrations() {
  const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  return rows.map((r) => r.name);
}

describe('runMigrations', () => {
  it('applies .sql files in lexical order and ignores other files', async () => {
    const ran = await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });

    expect(ran).toEqual(['001_create_a.sql', '002_create_b.sql', '010_seed_b.sql']);
    expect(await appliedMigrations()).toEqual(ran);
    expect(await tableNames()).toEqual(['fixture_a', 'fixture_b', 'schema_migrations']);
  });

  it('logs each applied migration', async () => {
    const log = [];
    await runMigrations(pool, { log: (msg) => log.push(msg), dir: fixtureDir('ok') });

    expect(log).toEqual([
      'Applied migration 001_create_a.sql',
      'Applied migration 002_create_b.sql',
      'Applied migration 010_seed_b.sql'
    ]);
  });

  it('only applies pending migrations on later runs', async () => {
    await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });
    await pool.query(`DELETE FROM schema_migrations WHERE name = '010_seed_b.sql'`);

    const ran = await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });

    expect(ran).toEqual(['010_seed_b.sql']);
  });

  it('is idempotent', async () => {
    await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') });
    expect(await runMigrations(pool, { ...quiet, dir: fixtureDir('ok') })).toEqual([]);
  });

  it('rolls back a failing migration and stops', async () => {
    await expect(runMigrations(pool, { ...quiet, dir: fixtureDir('failing') }))
      .rejects.toThrow(/^Migration 002_broken\.sql failed: /);

    expect(await appliedMigrations()).toEqual(['001_create_a.sql']);
    expect(await tableNames()).toEqual(['fixture_a', 'schema_migrations']);
  });

  it('serializes concurrent runs with an advisory lock', async () => {
    const results = await Promise.all([
      runMigrations(pool, { ...quiet, dir: fixtureDir('ok') }),
      runMigrations(pool, { ...quiet, dir: fixtureDir('ok') })
    ]);

    expect(results.flat().sort()).toEqual(['001_create_a.sql', '002_create_b.sql', '010_seed_b.sql']);
  });

  it('applies every real migration in server/migrations', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    expect(await runMigrations(pool, quiet)).toEqual(files);
  });
});

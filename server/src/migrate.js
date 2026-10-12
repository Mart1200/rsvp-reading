import { readdir, readFile } from 'node:fs/promises';

export const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

// Arbitrary constant so concurrent API instances don't migrate at the same time
const MIGRATION_LOCK_ID = 872341;

/**
 * Apply all pending SQL migrations in filename order.
 * Each migration runs in its own transaction and is recorded in schema_migrations.
 * @param {import('pg').Pool} pool - Postgres connection pool
 * @param {Object} [options]
 * @param {(msg: string) => void} [options.log] - Logger for applied migrations
 * @param {URL} [options.dir] - Directory containing the .sql files (default: server/migrations)
 * @returns {Promise<string[]>} Names of the migrations applied in this run
 */
export async function runMigrations(pool, { log = console.log, dir = MIGRATIONS_DIR } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(new URL(file, dir), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
      }
      ran.push(file);
      log(`Applied migration ${file}`);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

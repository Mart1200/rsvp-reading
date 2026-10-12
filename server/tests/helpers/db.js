import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://rsvp:rsvp@localhost:5432/rsvp_test';

/**
 * Create a pool on the shared test database.
 * The schema is migrated once by tests/global-setup.js.
 * @returns {import('pg').Pool}
 */
export function createTestPool() {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL });
}

/**
 * Empty every table except schema_migrations.
 * Picks up new tables automatically, so new migrations need no test changes.
 * @param {import('pg').Pool} pool
 */
export async function truncateAll(pool) {
  const { rows } = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> 'schema_migrations'
  `);
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

/**
 * Create a pool bound to a fresh, empty schema.
 * Used for migration tests so they don't touch the shared public schema.
 * @param {string} schema - Schema name (lowercase letters and underscores)
 * @returns {Promise<import('pg').Pool>}
 */
export async function createIsolatedPool(schema) {
  if (!/^[a-z_]+$/.test(schema)) throw new Error(`Invalid schema name: ${schema}`);

  const admin = createTestPool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
  await admin.end();

  return new pg.Pool({
    connectionString: TEST_DATABASE_URL,
    options: `-c search_path=${schema}`
  });
}

/**
 * Drop a schema created by createIsolatedPool
 * @param {string} schema
 */
export async function dropSchema(schema) {
  const admin = createTestPool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}

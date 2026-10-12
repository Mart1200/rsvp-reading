import { runMigrations } from '../src/migrate.js';
import { TEST_DATABASE_URL, createTestPool } from './helpers/db.js';

/**
 * Runs once before all test files: recreate the public schema and apply all migrations.
 * Individual tests only truncate data (see truncateAll).
 */
export default async function setup() {
  const pool = createTestPool();
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await runMigrations(pool, { log: () => {} });
  } catch (error) {
    throw new Error(
      `Could not prepare test database at ${TEST_DATABASE_URL}. ` +
      'Start it with: docker compose -f docker/docker-compose.dev.yml up -d',
      { cause: error }
    );
  } finally {
    await pool.end();
  }
}

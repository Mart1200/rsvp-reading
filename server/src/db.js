import pg from 'pg';

// Fail fast instead of waiting forever when the database is unreachable
export const CONNECTION_TIMEOUT_MS = 5000;

/**
 * Create the Postgres pool.
 * Without a connection string, pg reads PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT.
 * @param {Object} config
 * @param {string|null} config.databaseUrl
 * @param {Object} [options]
 * @param {(...args: any[]) => void} [options.log] - Logger for idle client errors
 * @returns {import('pg').Pool}
 */
export function createPool({ databaseUrl }, { log = console.error } = {}) {
  const pool = new pg.Pool({
    connectionString: databaseUrl ?? undefined,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS
  });

  // Idle clients emit 'error' when Postgres restarts or the network drops.
  // Without a listener Node treats it as unhandled and the process exits.
  pool.on('error', (error) => log('Idle Postgres client error:', error.message));

  return pool;
}

// Apply pending migrations without starting the API: npm run migrate
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { runMigrations } from '../src/migrate.js';

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });

try {
  const ran = await runMigrations(pool);
  if (ran.length === 0) console.log('No pending migrations');
} finally {
  await pool.end();
}

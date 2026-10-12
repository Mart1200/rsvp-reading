import { serve } from '@hono/node-server';
import pg from 'pg';
import { loadConfig } from './config.js';
import { runMigrations } from './migrate.js';
import { createApp } from './app.js';

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });

await runMigrations(pool);

const server = serve(
  { fetch: createApp({ pool, staticDir: config.staticDir }).fetch, port: config.port, hostname: '0.0.0.0' },
  (info) => console.log(`API listening on port ${info.port}`)
);

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

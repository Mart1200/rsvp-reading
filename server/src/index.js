import { serve } from '@hono/node-server';
import { createPool } from './db.js';
import { loadConfig } from './config.js';
import { runMigrations } from './migrate.js';
import { createApp } from './app.js';

const config = loadConfig(process.env);
const pool = createPool(config);

await runMigrations(pool);

const app = createApp({
  pool,
  origin: config.origin,
  cookieSecure: config.cookieSecure,
  trustProxy: config.trustProxy,
  staticDir: config.staticDir
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: '0.0.0.0' },
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

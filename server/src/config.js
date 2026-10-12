import { resolve } from 'node:path';

/**
 * Read and validate server configuration from environment variables
 * @param {Object} env - Environment (usually process.env)
 * @returns {{databaseUrl: string, port: number, cookieSecure: boolean, origin: string, staticDir: string|null}}
 */
export function loadConfig(env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}"`);
  }

  return {
    databaseUrl: env.DATABASE_URL,
    port,
    // Secure cookies by default; only disable for plain-http local setups
    cookieSecure: env.COOKIE_SECURE !== 'false',
    // Origin allowed to send mutating requests (CSRF check)
    origin: env.ORIGIN ?? 'http://localhost:5173',
    // Frontend build (Vite dist) to serve; unset in development where Vite serves it
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : null
  };
}

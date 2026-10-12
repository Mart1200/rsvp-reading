import { resolve } from 'node:path';

const DEV_ORIGIN = 'http://localhost:5173';

/**
 * Read and validate server configuration from environment variables
 * @param {Object} env - Environment (usually process.env)
 * @returns {{databaseUrl: string|null, port: number, cookieSecure: boolean, origin: string, trustProxy: boolean, staticDir: string|null}}
 */
export function loadConfig(env) {
  // Either a connection string or the PG* variables pg reads natively
  // (PGPASSWORD needs no URL encoding, unlike a password inside DATABASE_URL)
  if (!env.DATABASE_URL && !env.PGHOST) {
    throw new Error('DATABASE_URL or PGHOST is required');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}"`);
  }

  // A wrong origin makes every mutating request fail the CSRF check,
  // so production must set it explicitly instead of falling back to the dev server
  if (!env.ORIGIN && env.NODE_ENV === 'production') {
    throw new Error('ORIGIN is required in production, e.g. ORIGIN=https://rsvp.example.com');
  }

  return {
    databaseUrl: env.DATABASE_URL || null,
    port,
    // Secure cookies by default; only disable for plain-http setups
    cookieSecure: env.COOKIE_SECURE !== 'false',
    // Origin allowed to send mutating requests (CSRF check)
    origin: parseOrigin(env.ORIGIN ?? DEV_ORIGIN),
    // Behind a reverse proxy: take the client IP for rate limiting from X-Forwarded-For
    trustProxy: env.TRUST_PROXY === 'true',
    // Frontend build (Vite dist) to serve; unset in development where Vite serves it
    staticDir: env.STATIC_DIR ? resolve(env.STATIC_DIR) : null
  };
}

/**
 * Validate and normalize an origin such as "https://rsvp.example.com"
 * @param {string} value
 * @returns {string} Normalized origin (lowercase host, no trailing slash)
 */
function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`ORIGIN must be scheme + host (+ port), e.g. https://rsvp.example.com, got "${value}"`);
  }
  return url.origin;
}

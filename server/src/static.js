import { serveStatic } from '@hono/node-server/serve-static';

// Vite puts content-hashed bundles here, so they can be cached forever
const IMMUTABLE_PREFIX = '/assets/';
const HAS_EXTENSION = /\.[^/]+$/;

/**
 * Whether a path belongs to the API (never served from the frontend build)
 * @param {string} path
 * @returns {boolean}
 */
export function isApiPath(path) {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * Cache-Control value for a served frontend file
 * @param {string} path - Request path
 * @returns {string}
 */
export function cacheControlFor(path) {
  return path.startsWith(IMMUTABLE_PREFIX)
    ? 'public, max-age=31536000, immutable'
    // index.html, sw.js, manifest, icons: always revalidate so deploys show up immediately
    : 'no-cache';
}

/**
 * Serve the built frontend (Vite dist) from the API process.
 * - Existing files are served as-is.
 * - Paths without a file extension fall back to index.html (SPA routing).
 * - /api/* and missing files with an extension fall through to the 404 handler.
 * @param {import('hono').Hono} app
 * @param {string} staticDir - Directory containing index.html
 */
export function serveFrontend(app, staticDir) {
  const files = serveStatic({ root: staticDir });
  const indexHtml = serveStatic({ root: staticDir, path: 'index.html' });

  app.get('*', async (c, next) => {
    const path = c.req.path;
    if (isApiPath(path)) return next();

    const fallback = HAS_EXTENSION.test(path) ? next : () => indexHtml(c, next);
    const res = await files(c, fallback);
    // When nothing matched, next() ran the remaining handlers and returns no Response
    if (res instanceof Response) {
      // index.html served as SPA fallback must also revalidate
      res.headers.set('Cache-Control', HAS_EXTENSION.test(path) ? cacheControlFor(path) : 'no-cache');
    }
    return res;
  });
}

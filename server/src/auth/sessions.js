import { createHash, randomBytes } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HttpError } from '../errors.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Sliding expiry is written to the database at most once per this interval
export const SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 32 random bytes as base64url
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Only the SHA-256 of the token is stored, so a database leak doesn't expose usable sessions
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session for a user and remove the user's expired sessions
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {Date} [now]
 * @returns {Promise<{token: string, expiresAt: Date}>} token goes into the cookie
 */
export async function createSession(pool, userId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  // One round trip: drop the user's expired sessions and insert the new one
  await pool.query(
    `WITH expired AS (DELETE FROM sessions WHERE user_id = $2 AND expires_at <= $4)
     INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [hashToken(token), userId, expiresAt, now]
  );
  return { token, expiresAt };
}

/**
 * Look up a session by its cookie token, extending it when due (sliding expiry)
 * @param {import('pg').Pool} pool
 * @param {string} token
 * @param {Date} [now]
 * @returns {Promise<{user: {id: string, username: string, settings: Object}, expiresAt: Date, refreshed: boolean}|null>}
 */
export async function findSession(pool, token, now = new Date()) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;

  const id = hashToken(token);
  const { rows } = await pool.query(
    `SELECT s.expires_at, u.id, u.username, u.settings
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [id]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  if (row.expires_at <= now) {
    await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
    return null;
  }

  let expiresAt = row.expires_at;
  const lastExtendedAt = expiresAt.getTime() - SESSION_TTL_MS;
  const refreshed = now.getTime() - lastExtendedAt >= SESSION_REFRESH_INTERVAL_MS;
  if (refreshed) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await pool.query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [id, expiresAt]);
  }

  return {
    user: { id: row.id, username: row.username, settings: row.settings },
    expiresAt,
    refreshed
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} token
 */
export async function deleteSession(pool, token) {
  await pool.query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
}

/**
 * Delete all sessions of a user, optionally keeping one
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {string} [keepToken] - Cookie token of the session to keep
 */
export async function deleteUserSessions(pool, userId, keepToken) {
  if (keepToken) {
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, hashToken(keepToken)]);
  } else {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}

/**
 * @param {import('hono').Context} c
 * @param {string} token
 * @param {Date} expiresAt
 * @param {boolean} secure
 */
export function setSessionCookie(c, token, expiresAt, secure) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt
  });
}

/**
 * @param {import('hono').Context} c
 * @param {boolean} secure
 */
export function clearSessionCookie(c, secure) {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure, sameSite: 'Lax', path: '/' });
}

/**
 * Middleware: resolve the session cookie to c.get('user') / c.get('sessionToken')
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {boolean} deps.cookieSecure
 * @returns {import('hono').MiddlewareHandler}
 */
export function sessionMiddleware({ pool, cookieSecure }) {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = await findSession(pool, token);
      if (session) {
        c.set('user', session.user);
        c.set('sessionToken', token);
        if (session.refreshed) setSessionCookie(c, token, session.expiresAt, cookieSecure);
      } else {
        clearSessionCookie(c, cookieSecure);
      }
    }
    await next();
  };
}

/**
 * Return the logged-in user or throw 401
 * @param {import('hono').Context} c
 * @returns {{id: string, username: string, settings: Object}}
 */
export function requireUser(c) {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Not logged in');
  return user;
}

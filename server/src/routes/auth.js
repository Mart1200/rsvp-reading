import { Hono } from 'hono';
import { HttpError } from '../errors.js';
import { readJsonObject } from '../request.js';
import { hashPassword, verifyPassword, verifyAgainstDummy } from '../auth/password.js';
import { usernameError, passwordError, assertValid } from '../auth/validation.js';
import { consume } from '../auth/rate-limit.js';
import { parseSettings } from '../auth/settings.js';
import {
  createSession, deleteSession, deleteUserSessions,
  setSessionCookie, clearSessionCookie, requireUser
} from '../auth/sessions.js';

/**
 * Public representation of a user
 * @param {{id: string, username: string, settings: Object}} row
 */
function toUser(row) {
  return { id: row.id, username: row.username, settings: row.settings };
}

/**
 * Reserve an attempt on every [limiter, key] pair, or throw 429 if any is exhausted.
 * The attempt is counted before the slow password check, so concurrent requests
 * can't all slip through; legitimate attempts are refunded afterwards.
 * @param {Array<[ReturnType<import('../auth/rate-limit.js').createRateLimiter>, string]>} entries
 * @param {string} message
 */
function reserveAttempt(entries, message) {
  const { limited, retryAfterSeconds } = consume(entries);
  if (limited) {
    throw new HttpError(429, 'RATE_LIMITED', `${message} Try again in ${retryAfterSeconds} s.`, {
      headers: { 'Retry-After': String(retryAfterSeconds) }
    });
  }
}

/**
 * Routes under /api/auth
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {boolean} deps.cookieSecure
 * @param {(c: import('hono').Context) => string} deps.getIp
 * @param {Object} deps.limiters - see DEFAULT_RATE_LIMITS in app.js
 * @param {ReturnType<import('../auth/rate-limit.js').createRateLimiter>} deps.limiters.login - failed logins per IP + username
 * @param {ReturnType<import('../auth/rate-limit.js').createRateLimiter>} deps.limiters.loginIp - failed logins per IP, any username (password spraying)
 * @param {ReturnType<import('../auth/rate-limit.js').createRateLimiter>} deps.limiters.loginAccount - failed logins per username, any IP (distributed guessing)
 * @param {ReturnType<import('../auth/rate-limit.js').createRateLimiter>} deps.limiters.register - registrations per IP
 * @param {ReturnType<import('../auth/rate-limit.js').createRateLimiter>} deps.limiters.password - wrong current passwords per user
 * @returns {Hono}
 */
export function authRoutes({ pool, cookieSecure, getIp, limiters }) {
  const routes = new Hono();

  async function startSession(c, userId) {
    // Replace a session the client may already have
    const previousToken = c.get('sessionToken');
    if (previousToken) await deleteSession(pool, previousToken);

    const { token, expiresAt } = await createSession(pool, userId);
    setSessionCookie(c, token, expiresAt, cookieSecure);
  }

  // Check the logged-in user's password, limiting wrong guesses with a stolen session
  async function assertCurrentPassword(user, password) {
    const key = user.id;
    reserveAttempt([[limiters.password, key]], 'Too many wrong passwords.');

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    const ok = typeof password === 'string' && rows.length > 0 &&
      await verifyPassword(rows[0].password_hash, password);
    // A wrong password keeps the reserved attempt counted
    if (!ok) throw new HttpError(403, 'INVALID_PASSWORD', 'Password is wrong');
    limiters.password.reset(key);
  }

  routes.post('/register', async (c) => {
    const { username, password } = await readJsonObject(c);
    assertValid(usernameError(username));
    assertValid(passwordError(password));

    // Cheap check first, so retrying taken names costs neither a hash nor quota
    const taken = await pool.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username]);
    if (taken.rows.length > 0) throw new HttpError(409, 'USERNAME_TAKEN', 'Username is already taken');

    const ipKey = getIp(c);
    reserveAttempt([[limiters.register, ipKey]], 'Too many registrations.');

    let row;
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         RETURNING id, username, settings`,
        [username, await hashPassword(password)]
      );
      row = rows[0];
    } catch (error) {
      // Someone registered the same name in the meantime
      if (error.code === '23505') {
        limiters.register.undo(ipKey);
        throw new HttpError(409, 'USERNAME_TAKEN', 'Username is already taken');
      }
      throw error;
    }

    await startSession(c, row.id);
    return c.json({ user: toUser(row) }, 201);
  });

  routes.post('/login', async (c) => {
    const { username, password } = await readJsonObject(c);
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'VALIDATION', 'Username and password are required');
    }

    const ip = getIp(c);
    // Cap the key length: usernames are at most 32 characters, but the body may be up to 20 MB
    const account = username.toLowerCase().slice(0, 64);
    const key = `${ip}|${account}`;
    reserveAttempt(
      [[limiters.login, key], [limiters.loginIp, ip], [limiters.loginAccount, account]],
      'Too many failed login attempts.'
    );

    const { rows } = await pool.query(
      'SELECT id, username, settings, password_hash FROM users WHERE lower(username) = lower($1)',
      [username]
    );
    const row = rows[0];
    const ok = row
      ? await verifyPassword(row.password_hash, password)
      : await verifyAgainstDummy(password);

    if (!ok) {
      // The reserved attempt stays counted as a failure.
      // Same message for unknown users and wrong passwords.
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }

    // Successful logins are not failures: refund the reserved attempts
    limiters.login.reset(key);
    limiters.loginIp.undo(ip);
    limiters.loginAccount.undo(account);
    await startSession(c, row.id);
    return c.json({ user: toUser(row) });
  });

  routes.post('/logout', async (c) => {
    const token = c.get('sessionToken');
    if (token) await deleteSession(pool, token);
    clearSessionCookie(c, cookieSecure);
    return c.body(null, 204);
  });

  routes.get('/me', (c) => c.json({ user: toUser(requireUser(c)) }));

  // Replaces the stored settings (one copy per account, shared by all devices)
  async function storeSettings(c) {
    const user = requireUser(c);
    const settings = parseSettings((await readJsonObject(c)).settings);

    await pool.query('UPDATE users SET settings = $2 WHERE id = $1', [user.id, JSON.stringify(settings)]);
    return c.body(null, 204);
  }

  routes.put('/settings', storeSettings);
  // Same for navigator.sendBeacon when the page is hidden or closed (see BEACON_PATHS)
  routes.post('/settings', storeSettings);

  routes.post('/password', async (c) => {
    const user = requireUser(c);
    const { currentPassword, newPassword } = await readJsonObject(c);
    assertValid(passwordError(newPassword));
    await assertCurrentPassword(user, currentPassword);

    await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(newPassword)]);
    // Sign out everywhere else, e.g. a device the password was leaked to
    await deleteUserSessions(pool, user.id, c.get('sessionToken'));
    return c.body(null, 204);
  });

  routes.delete('/account', async (c) => {
    const user = requireUser(c);
    const { password } = await readJsonObject(c);
    await assertCurrentPassword(user, password);

    // Texts, progress and sessions are removed by ON DELETE CASCADE
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    limiters.password.reset(user.id);
    clearSessionCookie(c, cookieSecure);
    return c.body(null, 204);
  });

  return routes;
}

import { randomBytes } from 'node:crypto';
import { hashPassword } from './password.js';
import { passwordError } from './validation.js';
import { deleteUserSessions } from './sessions.js';

/**
 * Random password for admin resets (16 characters, base64url)
 * @returns {string}
 */
export function generatePassword() {
  return randomBytes(12).toString('base64url');
}

/**
 * Set a new password for a user and sign them out everywhere
 * @param {import('pg').Pool} pool
 * @param {string} username - Matched case-insensitively
 * @param {string} newPassword
 * @returns {Promise<string>} The username as stored
 */
export async function resetPassword(pool, username, newPassword) {
  const invalid = passwordError(newPassword);
  if (invalid) throw new Error(invalid);

  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $2 WHERE lower(username) = lower($1) RETURNING id, username',
    [username, await hashPassword(newPassword)]
  );
  if (rows.length === 0) throw new Error(`User "${username}" not found`);

  await deleteUserSessions(pool, rows[0].id);
  return rows[0].username;
}

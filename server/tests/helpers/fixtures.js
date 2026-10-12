import { hashPassword } from '../../src/auth/password.js';

/**
 * Insert test rows directly into the database.
 * Every field can be overridden; defaults produce valid rows.
 */

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * @param {import('pg').Pool} pool
 * @param {Object} [overrides] - Column values, e.g. { username: 'alice' },
 *   or `password` to store a real argon2 hash of it
 * @returns {Promise<Object>} Inserted users row
 */
export async function createUser(pool, overrides = {}) {
  const { password, ...columns } = overrides;
  const row = {
    username: `user_${unique()}`,
    password_hash: password ? await hashPassword(password) : 'not-a-real-hash',
    settings: {},
    ...columns
  };
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, settings)
     VALUES ($1, $2, $3) RETURNING *`,
    [row.username, row.password_hash, row.settings]
  );
  return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} ownerId - users.id of the owner
 * @param {Object} [overrides] - Column values, e.g. { title: 'Book' }
 * @returns {Promise<Object>} Inserted texts row
 */
export async function createText(pool, ownerId, overrides = {}) {
  const content = overrides.content ?? 'The quick brown fox jumps over the lazy dog';
  const row = {
    title: 'Test text',
    content,
    chapters: [],
    total_words: content.split(/\s+/).filter(Boolean).length,
    visibility: 'private',
    ...overrides
  };
  const { rows } = await pool.query(
    `INSERT INTO texts (owner_id, title, content, chapters, total_words, visibility)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [ownerId, row.title, row.content, JSON.stringify(row.chapters), row.total_words, row.visibility]
  );
  return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {string} textId
 * @param {number} [currentWordIndex]
 * @returns {Promise<Object>} Inserted progress row
 */
export async function createProgress(pool, userId, textId, currentWordIndex = 0) {
  const { rows } = await pool.query(
    `INSERT INTO progress (user_id, text_id, current_word_index)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, textId, currentWordIndex]
  );
  return rows[0];
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} userId
 * @param {Object} [overrides] - e.g. { id: 'abc', expires_at: new Date() }
 * @returns {Promise<Object>} Inserted sessions row
 */
export async function createSession(pool, userId, overrides = {}) {
  const row = {
    id: `session_${unique()}`,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides
  };
  const { rows } = await pool.query(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING *',
    [row.id, userId, row.expires_at]
  );
  return rows[0];
}

/**
 * Count rows in a table
 * @param {import('pg').Pool} pool
 * @param {string} table
 * @returns {Promise<number>}
 */
export async function countRows(pool, table) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}

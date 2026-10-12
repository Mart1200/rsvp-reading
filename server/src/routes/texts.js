import { Hono } from 'hono';
import { HttpError } from '../errors.js';
import { readJsonObject } from '../request.js';
import { requireUser } from '../auth/sessions.js';
import { countWords } from '../texts/words.js';
import {
  assertTextId, parseTitle, parseContent, parseWordIndex, parseChapters
} from '../texts/validation.js';

// Columns shared by list and detail responses. Progress is per reader, so it is
// joined for the requesting user (texts may be shared publicly later).
const SUMMARY_COLUMNS = `
  t.id, t.title, t.total_words, t.created_at,
  COALESCE(p.current_word_index, 0) AS current_word_index,
  p.updated_at AS last_read_at`;

const FROM_OWN_TEXTS = `
  FROM texts t
  LEFT JOIN progress p ON p.text_id = t.id AND p.user_id = $1
  WHERE t.owner_id = $1`;

/**
 * @param {Object} row - Row selected with SUMMARY_COLUMNS
 */
function toSummary(row) {
  return {
    id: row.id,
    title: row.title,
    totalWords: row.total_words,
    currentWordIndex: row.current_word_index,
    progressPercent: progressPercent(row.current_word_index, row.total_words),
    lastReadAt: row.last_read_at,
    createdAt: row.created_at
  };
}

/**
 * Whole percent, rounded down so a text only shows 100 % when it is finished
 * @param {number} index
 * @param {number} total
 * @returns {number}
 */
export function progressPercent(index, total) {
  return total > 0 ? Math.floor((index / total) * 100) : 0;
}

/**
 * Routes under /api/texts (all require login, only the user's own texts)
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {Hono}
 */
export function textRoutes({ pool }) {
  const routes = new Hono();

  // Load one of the user's texts or throw 404 (also for other users' texts)
  async function findOwnText(userId, id, extraColumns = '') {
    assertTextId(id);
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS}${extraColumns} ${FROM_OWN_TEXTS} AND t.id = $2`,
      [userId, id]
    );
    if (rows.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Text not found');
    return rows[0];
  }

  routes.get('/', async (c) => {
    const user = requireUser(c);
    const { rows } = await pool.query(
      `SELECT ${SUMMARY_COLUMNS} ${FROM_OWN_TEXTS}
       ORDER BY COALESCE(p.updated_at, t.created_at) DESC, t.created_at DESC`,
      [user.id]
    );
    return c.json({ texts: rows.map(toSummary) });
  });

  routes.post('/', async (c) => {
    const user = requireUser(c);
    const body = await readJsonObject(c);

    const title = parseTitle(body.title);
    const totalWords = countWords(body.content);
    const content = parseContent(body.content, totalWords);
    const chapters = parseChapters(body.chapters, totalWords);
    const currentWordIndex = body.currentWordIndex === undefined
      ? 0
      : parseWordIndex(body.currentWordIndex, totalWords);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [text] } = await client.query(
        `INSERT INTO texts (owner_id, title, content, chapters, total_words)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user.id, title, content, JSON.stringify(chapters), totalWords]
      );
      await client.query(
        'INSERT INTO progress (user_id, text_id, current_word_index) VALUES ($1, $2, $3)',
        [user.id, text.id, currentWordIndex]
      );
      await client.query('COMMIT');

      const row = await findOwnText(user.id, text.id);
      return c.json({ text: toSummary(row) }, 201);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  routes.get('/:id', async (c) => {
    const user = requireUser(c);
    const row = await findOwnText(user.id, c.req.param('id'), ', t.content, t.chapters');
    return c.json({ text: { ...toSummary(row), content: row.content, chapters: row.chapters } });
  });

  routes.patch('/:id', async (c) => {
    const user = requireUser(c);
    const id = c.req.param('id');
    assertTextId(id);
    const title = parseTitle((await readJsonObject(c)).title);

    const { rowCount } = await pool.query(
      'UPDATE texts SET title = $3, updated_at = now() WHERE id = $2 AND owner_id = $1',
      [user.id, id, title]
    );
    if (rowCount === 0) throw new HttpError(404, 'NOT_FOUND', 'Text not found');
    return c.json({ text: toSummary(await findOwnText(user.id, id)) });
  });

  routes.delete('/:id', async (c) => {
    const user = requireUser(c);
    const id = c.req.param('id');
    assertTextId(id);

    // Progress rows go with it (ON DELETE CASCADE)
    const { rowCount } = await pool.query('DELETE FROM texts WHERE id = $2 AND owner_id = $1', [user.id, id]);
    if (rowCount === 0) throw new HttpError(404, 'NOT_FOUND', 'Text not found');
    return c.body(null, 204);
  });

  routes.put('/:id/progress', async (c) => {
    const user = requireUser(c);
    const row = await findOwnText(user.id, c.req.param('id'));
    const body = await readJsonObject(c);
    if (!Number.isInteger(body.currentWordIndex)) {
      throw new HttpError(400, 'VALIDATION', 'currentWordIndex must be an integer');
    }
    // Clamp instead of rejecting: the client may lag behind slightly
    const index = Math.max(0, Math.min(row.total_words, body.currentWordIndex));

    await pool.query(
      `INSERT INTO progress (user_id, text_id, current_word_index) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, text_id)
       DO UPDATE SET current_word_index = EXCLUDED.current_word_index, updated_at = now()`,
      [user.id, row.id, index]
    );
    return c.body(null, 204);
  });

  return routes;
}

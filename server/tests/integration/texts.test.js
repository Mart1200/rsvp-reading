import { describe, it, expect } from 'vitest';
import { setupTestApp } from '../helpers/app.js';
import { createText, createProgress, countRows } from '../helpers/fixtures.js';

const ctx = setupTestApp();
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const sample = {
  title: 'Moby Dick',
  content: 'Call me Ishmael. Some years ago never mind how long precisely',
  chapters: [{ title: 'Loomings', wordIndex: 0, level: 0 }]
};

async function saveText(cookie, body = sample) {
  return ctx.request('POST', '/api/texts', { body, cookie });
}

describe('POST /api/texts', () => {
  it('saves the text with server-side word count and returns a summary', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await saveText(cookie, { ...sample, currentWordIndex: 3 });

    expect(res.status).toBe(201);
    expect(res.body.text).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: 'Moby Dick',
      totalWords: 11,
      currentWordIndex: 3,
      progressPercent: 27,
      lastReadAt: expect.any(String),
      createdAt: expect.any(String)
    });
    expect(res.body.text.content).toBeUndefined();
  });

  it('ignores a client-provided totalWords', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await saveText(cookie, { ...sample, totalWords: 9999 });

    expect(res.body.text.totalWords).toBe(11);
  });

  it('starts at position 0 by default and stores the progress row', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await saveText(cookie);

    expect(res.body.text.currentWordIndex).toBe(0);
    expect(await countRows(ctx.pool, 'progress')).toBe(1);
  });

  it('stores texts as private', async () => {
    const { cookie } = await ctx.loggedInUser();
    await saveText(cookie);

    const { rows } = await ctx.pool.query('SELECT visibility FROM texts');
    expect(rows[0].visibility).toBe('private');
  });

  it.each([
    ['empty title', { ...sample, title: '  ' }],
    ['empty content', { ...sample, content: '   ' }],
    ['position beyond the end', { ...sample, currentWordIndex: 12 }],
    ['chapter beyond the end', { ...sample, chapters: [{ title: 'x', wordIndex: 99, level: 0 }] }]
  ])('rejects %s with 400 and stores nothing', async (_, body) => {
    const { cookie } = await ctx.loggedInUser();

    const res = await saveText(cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(await countRows(ctx.pool, 'texts')).toBe(0);
  });

  it('accepts a position at the very end (finished)', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await saveText(cookie, { ...sample, currentWordIndex: 11 });

    expect(res.body.text.progressPercent).toBe(100);
  });
});

describe('GET /api/texts', () => {
  it('lists only the user\'s own texts without content', async () => {
    const alice = await ctx.loggedInUser();
    const bob = await ctx.loggedInUser();
    await createText(ctx.pool, alice.user.id, { title: 'Alice text' });
    await createText(ctx.pool, bob.user.id, { title: 'Bob text' });

    const res = await ctx.request('GET', '/api/texts', { cookie: alice.cookie });

    expect(res.status).toBe(200);
    expect(res.body.texts.map((t) => t.title)).toEqual(['Alice text']);
    expect(res.body.texts[0].content).toBeUndefined();
  });

  it('returns an empty list for a new user', async () => {
    const { cookie } = await ctx.loggedInUser();

    const res = await ctx.request('GET', '/api/texts', { cookie });

    expect(res.body).toEqual({ texts: [] });
  });

  it('sorts by last read, falling back to creation time', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const old = await createText(ctx.pool, user.id, { title: 'read yesterday' });
    const fresh = await createText(ctx.pool, user.id, { title: 'never read' });
    const recent = await createText(ctx.pool, user.id, { title: 'read just now' });
    await ctx.pool.query("UPDATE texts SET created_at = now() - interval '10 days' WHERE id IN ($1, $2)", [old.id, recent.id]);
    await ctx.pool.query("UPDATE texts SET created_at = now() - interval '1 hour' WHERE id = $1", [fresh.id]);
    await ctx.pool.query(
      `INSERT INTO progress (user_id, text_id, current_word_index, updated_at) VALUES
       ($1, $2, 1, now() - interval '1 day'), ($1, $3, 1, now())`,
      [user.id, old.id, recent.id]
    );

    const res = await ctx.request('GET', '/api/texts', { cookie });

    expect(res.body.texts.map((t) => t.title)).toEqual(['read just now', 'never read', 'read yesterday']);
  });

  it('reports lastReadAt null and position 0 without a progress row', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    await createText(ctx.pool, user.id);

    const res = await ctx.request('GET', '/api/texts', { cookie });

    expect(res.body.texts[0]).toMatchObject({ currentWordIndex: 0, progressPercent: 0, lastReadAt: null });
  });
});

describe('GET /api/texts/:id', () => {
  it('returns content, chapters and position', async () => {
    const { cookie } = await ctx.loggedInUser();
    const { body } = await saveText(cookie, { ...sample, currentWordIndex: 5 });

    const res = await ctx.request('GET', `/api/texts/${body.text.id}`, { cookie });

    expect(res.status).toBe(200);
    expect(res.body.text).toMatchObject({
      id: body.text.id,
      title: 'Moby Dick',
      content: sample.content,
      chapters: sample.chapters,
      currentWordIndex: 5,
      totalWords: 11
    });
  });
});

describe('PATCH /api/texts/:id', () => {
  it('renames the text', async () => {
    const { cookie } = await ctx.loggedInUser();
    const { body } = await saveText(cookie);

    const res = await ctx.request('PATCH', `/api/texts/${body.text.id}`, { body: { title: '  New title ' }, cookie });

    expect(res.status).toBe(200);
    expect(res.body.text.title).toBe('New title');
  });

  it('validates the title', async () => {
    const { cookie } = await ctx.loggedInUser();
    const { body } = await saveText(cookie);

    const res = await ctx.request('PATCH', `/api/texts/${body.text.id}`, { body: { title: '' }, cookie });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/texts/:id', () => {
  it('deletes the text and its progress', async () => {
    const { cookie } = await ctx.loggedInUser();
    const { body } = await saveText(cookie);

    const res = await ctx.request('DELETE', `/api/texts/${body.text.id}`, { body: {}, cookie });

    expect(res.status).toBe(204);
    expect(await countRows(ctx.pool, 'texts')).toBe(0);
    expect(await countRows(ctx.pool, 'progress')).toBe(0);
  });
});

describe('PUT /api/texts/:id/progress', () => {
  const put = (cookie, id, body) => ctx.request('PUT', `/api/texts/${id}/progress`, { body, cookie });

  it('updates the position and lastReadAt', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);
    await createProgress(ctx.pool, user.id, text.id, 2);
    await ctx.pool.query("UPDATE progress SET updated_at = now() - interval '1 day'");

    expect((await put(cookie, text.id, { currentWordIndex: 0 })).status).toBe(204);

    const { body } = await ctx.request('GET', `/api/texts/${text.id}`, { cookie });
    expect(body.text.currentWordIndex).toBe(0);
    expect(Date.now() - new Date(body.text.lastReadAt).getTime()).toBeLessThan(60_000);
  });

  it('creates the progress row if it is missing', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    await put(cookie, text.id, { currentWordIndex: 4 });

    expect(await countRows(ctx.pool, 'progress')).toBe(1);
  });

  it.each([[-5, 0], [999, 9]])('clamps %i to %i', async (value, expected) => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    await put(cookie, text.id, { currentWordIndex: value });

    const { body } = await ctx.request('GET', `/api/texts/${text.id}`, { cookie });
    expect(body.text.currentWordIndex).toBe(expected);
  });

  it('requires an integer', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    expect((await put(cookie, text.id, { currentWordIndex: 'x' })).status).toBe(400);
  });
});

describe('POST /api/texts/:id/progress (sendBeacon)', () => {
  // What navigator.sendBeacon sends for a string body
  const beacon = (cookie, id, body, headers = {}) => ctx.request('POST', `/api/texts/${id}/progress`, {
    body: JSON.stringify(body),
    cookie,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers }
  });

  it('accepts a text/plain JSON body', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    expect((await beacon(cookie, text.id, { currentWordIndex: 4 })).status).toBe(204);

    const { body } = await ctx.request('GET', `/api/texts/${text.id}`, { cookie });
    expect(body.text.currentWordIndex).toBe(4);
  });

  it('still checks the origin', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    const res = await beacon(cookie, text.id, { currentWordIndex: 4 }, { Origin: 'https://evil.example' });

    expect(res.status).toBe(403);
    expect(await countRows(ctx.pool, 'progress')).toBe(0);
  });

  it('rejects a body that is not JSON', async () => {
    const { user, cookie } = await ctx.loggedInUser();
    const text = await createText(ctx.pool, user.id);

    const res = await ctx.request('POST', `/api/texts/${text.id}/progress`, {
      body: 'currentWordIndex=4',
      cookie,
      headers: { 'Content-Type': 'text/plain' }
    });

    expect(res.status).toBe(400);
  });
});

describe('ownership and authentication', () => {
  const routes = [
    ['GET', (id) => `/api/texts/${id}`, undefined],
    ['PATCH', (id) => `/api/texts/${id}`, { title: 'hijacked' }],
    ['DELETE', (id) => `/api/texts/${id}`, {}],
    ['PUT', (id) => `/api/texts/${id}/progress`, { currentWordIndex: 1 }],
    ['POST', (id) => `/api/texts/${id}/progress`, { currentWordIndex: 1 }]
  ];

  it.each(routes)('%s on another user\'s text answers 404 and changes nothing', async (method, path, body) => {
    const alice = await ctx.loggedInUser();
    const bob = await ctx.loggedInUser();
    const text = await createText(ctx.pool, alice.user.id, { title: 'Alice text' });

    const res = await ctx.request(method, path(text.id), { body, cookie: bob.cookie });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const { rows } = await ctx.pool.query('SELECT title FROM texts');
    expect(rows).toEqual([{ title: 'Alice text' }]);
    expect(await countRows(ctx.pool, 'progress')).toBe(0);
  });

  it.each(routes)('%s on an unknown or malformed id answers 404', async (method, path, body) => {
    const { cookie } = await ctx.loggedInUser();

    for (const id of [UNKNOWN_ID, 'not-a-uuid']) {
      const res = await ctx.request(method, path(id), { body, cookie });
      expect(res.status, id).toBe(404);
    }
  });

  it.each([
    ['GET', '/api/texts', undefined],
    ['POST', '/api/texts', sample],
    ...routes.map(([method, path, body]) => [method, path(UNKNOWN_ID), body])
  ])('%s %s requires login', async (method, path, body) => {
    const res = await ctx.request(method, path, { body });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

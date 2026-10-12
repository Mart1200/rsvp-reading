import { describe, it, expect } from 'vitest';
import { setupTestApp } from '../helpers/app.js';
import {
  createUser, createText, createProgress, createSession, countRows
} from '../helpers/fixtures.js';

const ctx = setupTestApp();

describe('users', () => {
  it('generates a uuid and empty settings', async () => {
    const user = await createUser(ctx.pool, { username: 'Alice' });

    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.username).toBe('Alice');
    expect(user.settings).toEqual({});
    expect(user.created_at).toBeInstanceOf(Date);
  });

  it('enforces case-insensitive unique usernames', async () => {
    await createUser(ctx.pool, { username: 'Alice' });

    await expect(createUser(ctx.pool, { username: 'alice' }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('stores settings as jsonb', async () => {
    const user = await createUser(ctx.pool, { settings: { wordsPerMinute: 400 } });

    expect(user.settings).toEqual({ wordsPerMinute: 400 });
  });
});

describe('texts', () => {
  it('defaults to private visibility', async () => {
    const user = await createUser(ctx.pool);
    const text = await createText(ctx.pool, user.id);

    expect(text.visibility).toBe('private');
    expect(text.chapters).toEqual([]);
    expect(text.total_words).toBe(9);
  });

  it('allows public visibility for future sharing', async () => {
    const user = await createUser(ctx.pool);
    const text = await createText(ctx.pool, user.id, { visibility: 'public' });

    expect(text.visibility).toBe('public');
  });

  it('rejects unknown visibility values', async () => {
    const user = await createUser(ctx.pool);

    await expect(createText(ctx.pool, user.id, { visibility: 'friends' }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('stores chapters as jsonb', async () => {
    const user = await createUser(ctx.pool);
    const chapters = [{ title: 'Intro', wordIndex: 0 }, { title: 'Two', wordIndex: 5 }];
    const text = await createText(ctx.pool, user.id, { chapters });

    expect(text.chapters).toEqual(chapters);
  });

  it('requires an existing owner', async () => {
    await expect(createText(ctx.pool, '00000000-0000-0000-0000-000000000000'))
      .rejects.toMatchObject({ code: '23503' });
  });
});

describe('progress', () => {
  it('allows one row per user and text', async () => {
    const user = await createUser(ctx.pool);
    const text = await createText(ctx.pool, user.id);
    await createProgress(ctx.pool, user.id, text.id, 3);

    await expect(createProgress(ctx.pool, user.id, text.id, 4))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('tracks progress separately per reader of the same text', async () => {
    const owner = await createUser(ctx.pool);
    const reader = await createUser(ctx.pool);
    const text = await createText(ctx.pool, owner.id, { visibility: 'public' });

    await createProgress(ctx.pool, owner.id, text.id, 10);
    await createProgress(ctx.pool, reader.id, text.id, 2);

    expect(await countRows(ctx.pool, 'progress')).toBe(2);
  });

  it('is deleted together with its text', async () => {
    const user = await createUser(ctx.pool);
    const text = await createText(ctx.pool, user.id);
    await createProgress(ctx.pool, user.id, text.id);

    await ctx.pool.query('DELETE FROM texts WHERE id = $1', [text.id]);

    expect(await countRows(ctx.pool, 'progress')).toBe(0);
  });
});

describe('deleting a user', () => {
  it('cascades to texts, progress and sessions', async () => {
    const user = await createUser(ctx.pool);
    const text = await createText(ctx.pool, user.id);
    await createProgress(ctx.pool, user.id, text.id);
    await createSession(ctx.pool, user.id);

    await ctx.pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    for (const table of ['texts', 'progress', 'sessions']) {
      expect(await countRows(ctx.pool, table), table).toBe(0);
    }
  });

  it('leaves other users untouched', async () => {
    const alice = await createUser(ctx.pool);
    const bob = await createUser(ctx.pool);
    await createText(ctx.pool, bob.id);

    await ctx.pool.query('DELETE FROM users WHERE id = $1', [alice.id]);

    expect(await countRows(ctx.pool, 'users')).toBe(1);
    expect(await countRows(ctx.pool, 'texts')).toBe(1);
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listTexts, getText, saveText, renameText, deleteText, saveProgress,
  defaultTitle, formatRelativeTime, formatWordCount
} from '../lib/library.js';
import { mockFetch, apiError } from './helpers/fetch-mock.js';

const summary = { id: 't1', title: 'Moby Dick', totalWords: 10, currentWordIndex: 0, progressPercent: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('library API', () => {
  it('listTexts returns the texts', async () => {
    mockFetch({ 'GET /api/texts': { body: { texts: [summary] } } });

    expect(await listTexts()).toEqual([summary]);
  });

  it('getText returns the full text', async () => {
    mockFetch({ 'GET /api/texts/t1': { body: { text: { ...summary, content: 'x' } } } });

    expect((await getText('t1')).content).toBe('x');
  });

  it('saveText sends title, content, chapters and position', async () => {
    const server = mockFetch({ 'POST /api/texts': { status: 201, body: { text: summary } } });

    await saveText({ title: 'Moby Dick', content: 'Call me Ishmael', chapters: [], currentWordIndex: 2 });

    expect(server.calls('POST /api/texts')[0].body).toEqual({
      title: 'Moby Dick', content: 'Call me Ishmael', chapters: [], currentWordIndex: 2
    });
  });

  it('renameText, deleteText and saveProgress use the right endpoints', async () => {
    const server = mockFetch({
      'PATCH /api/texts/t1': { body: { text: { ...summary, title: 'New' } } },
      'DELETE /api/texts/t1': { status: 204 },
      'PUT /api/texts/t1/progress': { status: 204 }
    });

    expect((await renameText('t1', 'New')).title).toBe('New');
    await deleteText('t1');
    await saveProgress('t1', 7);

    expect(server.calls('PATCH /api/texts/t1')[0].body).toEqual({ title: 'New' });
    expect(server.calls('DELETE /api/texts/t1')).toHaveLength(1);
    expect(server.calls('PUT /api/texts/t1/progress')[0].body).toEqual({ currentWordIndex: 7 });
  });

  it('encodes ids in the path', async () => {
    const server = mockFetch({ 'GET /api/texts/a%2Fb': { body: { text: summary } } });

    await getText('a/b');

    expect(server.calls('GET /api/texts/a%2Fb')).toHaveLength(1);
  });

  it('passes API errors through', async () => {
    mockFetch({ 'GET /api/texts/t1': { status: 404, body: apiError('NOT_FOUND', 'Text not found') } });

    await expect(getText('t1')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('defaultTitle', () => {
  it('prefers the book title from the file', () => {
    expect(defaultTitle({ title: ' Moby-Dick ', fileName: 'moby.epub', text: 'x' })).toBe('Moby-Dick');
  });

  it('falls back to the file name without extension', () => {
    expect(defaultTitle({ fileName: 'My Report.final.pdf', text: 'x' })).toBe('My Report.final');
  });

  it('uses the first six words of pasted text', () => {
    expect(defaultTitle({ text: 'One two three four five six seven eight' })).toBe('One two three four five six…');
  });

  it('does not add an ellipsis to short texts', () => {
    expect(defaultTitle({ text: '  Just three words ' })).toBe('Just three words');
  });

  it('falls back to "Untitled"', () => {
    expect(defaultTitle({ text: '   ' })).toBe('Untitled');
  });

  it('stays within 200 characters', () => {
    const title = defaultTitle({ title: 'x'.repeat(500), text: '' });
    expect([...title]).toHaveLength(200);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const ago = (seconds) => new Date(now.getTime() - seconds * 1000).toISOString();

  it.each([
    [null, 'Never'],
    [ago(10), 'Just now'],
    [ago(5 * 60), '5 minutes ago'],
    [ago(3 * 3600), '3 hours ago'],
    [ago(24 * 3600), 'Yesterday'],
    [ago(3 * 24 * 3600), '3 days ago'],
    [ago(14 * 24 * 3600), '2 weeks ago'],
    [ago(400 * 24 * 3600), 'Last year']
  ])('%s -> %s', (date, expected) => {
    expect(formatRelativeTime(date, now)).toBe(expected);
  });
});

describe('formatWordCount', () => {
  it.each([[1, '1 word'], [2, '2 words'], [12345, '12,345 words']])('%i -> %s', (n, expected) => {
    expect(formatWordCount(n)).toBe(expected);
  });
});

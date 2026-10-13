import { describe, it, expect } from 'vitest';
import {
  assertTextId, parseTitle, parseContent, parseWordIndex, parseChapters,
  MAX_CHAPTERS
} from '../../src/texts/validation.js';
import { progressPercent } from '../../src/routes/texts.js';

const fails = (fn, code = 'VALIDATION') => {
  try {
    fn();
  } catch (error) {
    return error.code === code;
  }
  return false;
};

describe('assertTextId', () => {
  it('accepts UUIDs', () => {
    expect(() => assertTextId('3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f')).not.toThrow();
  });

  it.each(['1', 'abc', '3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6', "x' OR 1=1 --"])('answers %j with 404', (id) => {
    expect(fails(() => assertTextId(id), 'NOT_FOUND')).toBe(true);
  });
});

describe('parseTitle', () => {
  it('trims', () => {
    expect(parseTitle('  Moby Dick  ')).toBe('Moby Dick');
  });

  it('accepts 200 characters', () => {
    expect(parseTitle('a'.repeat(200))).toHaveLength(200);
  });

  it.each(['', '   ', 'a'.repeat(201), 42, null, undefined])('rejects %j', (title) => {
    expect(fails(() => parseTitle(title))).toBe(true);
  });
});

describe('parseContent', () => {
  it('accepts text with words', () => {
    expect(parseContent('hello', 1)).toBe('hello');
  });

  it.each([['', 0], ['   ', 0], [42, 0]])('rejects %j', (content, words) => {
    expect(fails(() => parseContent(content, words))).toBe(true);
  });
});

describe('parseWordIndex', () => {
  it.each([0, 5, 10])('accepts %i of 10', (i) => {
    expect(parseWordIndex(i, 10)).toBe(i);
  });

  it.each([-1, 11, 1.5, '3', null])('rejects %j', (i) => {
    expect(fails(() => parseWordIndex(i, 10))).toBe(true);
  });
});

describe('parseChapters', () => {
  it('returns [] when missing', () => {
    expect(parseChapters(undefined, 10)).toEqual([]);
    expect(parseChapters(null, 10)).toEqual([]);
  });

  it('keeps only known fields and defaults level to 0', () => {
    expect(parseChapters([{ title: 'Intro', wordIndex: 0, extra: 'x' }], 10))
      .toEqual([{ title: 'Intro', wordIndex: 0, level: 0 }]);
  });

  it.each([
    ['not an array', 'chapters'],
    ['missing title', [{ wordIndex: 0, level: 0 }]],
    ['wordIndex beyond the text', [{ title: 'x', wordIndex: 11, level: 0 }]],
    ['negative wordIndex', [{ title: 'x', wordIndex: -1, level: 0 }]],
    ['level too deep', [{ title: 'x', wordIndex: 0, level: 11 }]],
    ['null entry', [null]],
    ['too many', Array.from({ length: MAX_CHAPTERS + 1 }, () => ({ title: 'x', wordIndex: 0, level: 0 }))]
  ])('rejects %s', (_, chapters) => {
    expect(fails(() => parseChapters(chapters, 10))).toBe(true);
  });
});

describe('progressPercent', () => {
  it.each([[0, 100, 0], [50, 100, 50], [999, 1000, 99], [1000, 1000, 100], [0, 0, 0]])(
    '%i of %i -> %i %%',
    (index, total, expected) => expect(progressPercent(index, total)).toBe(expected)
  );
});

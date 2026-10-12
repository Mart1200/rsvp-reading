import { describe, it, expect } from 'vitest';
import { countWords } from '../../src/texts/words.js';
// The reader's word splitting; positions stored by the client refer to these words
import { parseText } from '../../../src/lib/rsvp-utils.js';

const samples = [
  'Hello world',
  '  leading and trailing  ',
  'tabs\tand\nnewlines\r\nmixed',
  'multiple     spaces',
  'Unicode: Größe, naïve café — 日本語 テキスト',
  'emoji 🔑 count 👍🏽 too',
  'non breaking space',
  'zero​width',
  'punctuation, stays. attached!',
  '',
  '   ',
  'one'
];

describe('countWords', () => {
  it.each(samples)('matches the reader for %j', (text) => {
    expect(countWords(text)).toBe(parseText(text).length);
  });

  it.each([null, undefined, 42, {}])('returns 0 for %j', (value) => {
    expect(countWords(value)).toBe(0);
  });
});

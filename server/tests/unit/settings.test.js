import { describe, it, expect } from 'vitest';
import { parseSettings, SETTING_TYPES } from '../../src/auth/settings.js';

const allSettings = {
  wordsPerMinute: 300,
  fadeEnabled: true,
  fadeDuration: 150,
  pauseOnPunctuation: true,
  punctuationPauseMultiplier: 2.5,
  wordLengthWPMMultiplier: 5,
  pauseAfterWords: 0,
  pauseDuration: 500,
  frameWordCount: 3,
  showContextEnabled: false
};

describe('parseSettings', () => {
  it('accepts every known setting', () => {
    expect(Object.keys(allSettings).sort()).toEqual(Object.keys(SETTING_TYPES).sort());
    expect(parseSettings(allSettings)).toEqual(allSettings);
  });

  it('accepts a subset and an empty object', () => {
    expect(parseSettings({ wordsPerMinute: 500 })).toEqual({ wordsPerMinute: 500 });
    expect(parseSettings({})).toEqual({});
  });

  it.each([
    ['null', null],
    ['an array', [1]],
    ['a string', 'x'],
    ['an unknown key', { theme: 'dark' }],
    ['a prototype key', JSON.parse('{"__proto__": 1}')],
    ['a string number', { wordsPerMinute: '300' }],
    ['NaN', { wordsPerMinute: NaN }],
    ['Infinity', { wordsPerMinute: Infinity }],
    ['a negative number', { fadeDuration: -1 }],
    ['a huge number', { pauseDuration: 1e9 }],
    ['a string boolean', { fadeEnabled: 'true' }],
    ['null as value', { fadeEnabled: null }]
  ])('rejects %s', (_, settings) => {
    expect(() => parseSettings(settings)).toThrow(expect.objectContaining({ status: 400, code: 'VALIDATION' }));
  });
});

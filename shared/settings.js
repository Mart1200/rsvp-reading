/**
 * Reader settings an account may store. Shared by the frontend (src/lib/settings-sync.js)
 * and the server (server/src/auth/settings.js), so both accept exactly the same values.
 * No imports: this file is copied as-is into both Docker build stages.
 */

/** Setting name → type */
export const SETTING_TYPES = {
  wordsPerMinute: 'number',
  fadeEnabled: 'boolean',
  fadeDuration: 'number',
  pauseOnPunctuation: 'boolean',
  punctuationPauseMultiplier: 'number',
  wordLengthWPMMultiplier: 'number',
  pauseAfterWords: 'number',
  pauseDuration: 'number',
  frameWordCount: 'number',
  showContextEnabled: 'boolean'
};

/** Generous upper bound for every number; the UI uses far smaller ranges */
export const SETTING_MAX_NUMBER = 100_000;

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isKnownSetting(key) {
  return Object.hasOwn(SETTING_TYPES, key);
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} Whether the setting is known and the value has the right type and range
 */
export function isValidSetting(key, value) {
  if (!isKnownSetting(key)) return false;
  return SETTING_TYPES[key] === 'number'
    ? Number.isFinite(value) && value >= 0 && value <= SETTING_MAX_NUMBER
    : typeof value === SETTING_TYPES[key];
}

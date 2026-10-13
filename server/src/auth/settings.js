import { HttpError } from '../errors.js';

/** Reader settings an account may store, with their type (see the settings in src/App.svelte) */
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

// Generous upper bound for every number; the UI uses far smaller ranges
const MAX_NUMBER = 100_000;

/**
 * Validate settings sent by the client. Every key is optional, unknown keys are rejected.
 * @param {unknown} settings
 * @returns {Object} The settings, unchanged
 */
export function parseSettings(settings) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new HttpError(400, 'VALIDATION', 'settings must be an object');
  }
  for (const [key, value] of Object.entries(settings)) {
    const type = Object.hasOwn(SETTING_TYPES, key) ? SETTING_TYPES[key] : null;
    if (!type) throw new HttpError(400, 'VALIDATION', `Unknown setting: ${key.slice(0, 64)}`);

    const valid = type === 'number'
      ? Number.isFinite(value) && value >= 0 && value <= MAX_NUMBER
      : typeof value === type;
    if (!valid) throw new HttpError(400, 'VALIDATION', `Invalid value for ${key}`);
  }
  return settings;
}

/**
 * Reader settings of a signed-in user, stored on the server (one copy per account)
 */

/** Changes are saved once the user stops adjusting for this long */
export const SETTINGS_SYNC_DELAY_MS = 1000;

/** Settings the server accepts, with their type (see server/src/auth/settings.js) */
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

/**
 * The known, well-typed settings from a stored object
 * @param {unknown} settings
 * @returns {Object}
 */
export function pickSettings(settings) {
  if (settings === null || typeof settings !== 'object') return {};
  return Object.fromEntries(
    Object.entries(SETTING_TYPES)
      .filter(([key, type]) => Object.hasOwn(settings, key) && (type === 'number'
        ? Number.isFinite(settings[key])
        : typeof settings[key] === type))
      .map(([key]) => [key, settings[key]])
  );
}

/**
 * Debounced uploads that skip settings the server already has
 * @param {Object} deps
 * @param {(settings: Object) => Promise<void>} deps.save
 * @param {number} [deps.delayMs]
 */
export function createSettingsSync({ save, delayMs = SETTINGS_SYNC_DELAY_MS }) {
  // JSON of the settings the server has (null: unknown)
  let saved = null;
  let timer = null;

  function cancel() {
    clearTimeout(timer);
    timer = null;
  }

  function saveNow(settings) {
    cancel();
    const json = JSON.stringify(settings);
    saved = json;
    // Failed: try again with the next change
    save(settings).catch(() => {
      if (saved === json) saved = null;
    });
  }

  return {
    /** @param {Object|null} settings - What the server has now; cancels pending uploads */
    reset(settings) {
      cancel();
      saved = settings ? JSON.stringify(settings) : null;
    },

    /** @param {Object} settings - Current settings; uploaded after the delay if they differ */
    changed(settings) {
      cancel();
      if (JSON.stringify(settings) === saved) return;
      timer = setTimeout(() => saveNow(settings), delayMs);
    },

    saveNow,
    cancel
  };
}

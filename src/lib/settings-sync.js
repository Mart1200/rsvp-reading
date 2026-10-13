/**
 * Reader settings of a signed-in user, stored on the server (one copy per account)
 */
import { SETTING_TYPES, isValidSetting } from '../../shared/settings.js';

export { SETTING_TYPES };

/** Settings of a new reader; the keys are exactly those in SETTING_TYPES */
export const DEFAULT_SETTINGS = {
  wordsPerMinute: 300,
  fadeEnabled: true,
  fadeDuration: 150,
  pauseOnPunctuation: true,
  punctuationPauseMultiplier: 2,
  wordLengthWPMMultiplier: 5,
  pauseAfterWords: 0,
  pauseDuration: 500,
  frameWordCount: 1,
  showContextEnabled: true
};

/** Changes are saved once the user stops adjusting for this long */
export const SETTINGS_SYNC_DELAY_MS = 1000;

/** Waits before retrying a failed upload; the last one repeats */
export const SETTINGS_RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

/**
 * The known, valid settings from a stored object
 * @param {unknown} settings
 * @returns {Object}
 */
export function pickSettings(settings) {
  if (settings === null || typeof settings !== 'object') return {};
  return Object.fromEntries(
    Object.keys(SETTING_TYPES)
      .filter((key) => Object.hasOwn(settings, key) && isValidSetting(key, settings[key]))
      .map((key) => [key, settings[key]])
  );
}

/**
 * Debounced uploads that skip settings the server already has. One request at a time;
 * changes made meanwhile are sent afterwards, failed uploads are retried with a backoff.
 * @param {Object} deps
 * @param {(settings: Object) => Promise<void>} deps.save - Regular request
 * @param {(settings: Object) => boolean} deps.beacon - Request that survives closing the page
 * @param {number} [deps.delayMs]
 * @param {number[]} [deps.retryDelaysMs]
 */
export function createSettingsSync({
  save,
  beacon,
  delayMs = SETTINGS_SYNC_DELAY_MS,
  retryDelaysMs = SETTINGS_RETRY_DELAYS_MS
}) {
  // JSON of the settings the server has (null: unknown)
  let saved = null;
  // Settings still to be sent, or null
  /** @type {Object|null} */
  let pending = null;
  /** @type {Promise<void>|null} */
  let inFlight = null;
  // JSON of the settings in flight
  let sending = null;
  let timer = null;
  let failures = 0;
  // Bumped by reset(): results of older requests belong to another account
  let generation = 0;

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      send();
    }, ms);
  }

  function send() {
    if (inFlight || !pending) return inFlight ?? Promise.resolve();
    clearTimeout(timer);
    timer = null;

    const settings = pending;
    const json = JSON.stringify(settings);
    if (json === saved) {
      pending = null;
      return Promise.resolve();
    }

    const startedIn = generation;
    sending = json;
    inFlight = save(settings).then(
      () => {
        if (startedIn !== generation) return;
        saved = json;
        failures = 0;
        if (pending === settings) pending = null;
      },
      () => {
        if (startedIn !== generation) return;
        failures++;
        // Nothing newer to send: retry these settings
        if (!pending) pending = settings;
      }
    ).finally(() => {
      inFlight = null;
      sending = null;
      if (startedIn !== generation || !pending || timer) return;
      // Failed: retry later. Changed meanwhile: send the newer settings now.
      if (pending === settings) schedule(retryDelaysMs[Math.min(failures, retryDelaysMs.length) - 1]);
      else send();
    });
    return inFlight;
  }

  return {
    /** @param {Object|null} settings - What the server has now; drops anything unsent */
    reset(settings) {
      generation++;
      clearTimeout(timer);
      timer = null;
      pending = null;
      failures = 0;
      saved = settings ? JSON.stringify(pickSettings(settings)) : null;
    },

    /** @param {Object} settings - Current settings; uploaded after the delay if they differ */
    changed(settings) {
      const valid = pickSettings(settings);
      // Already on the server, or on the way there (retried if that fails)
      if (JSON.stringify(valid) === (inFlight ? sending : saved)) {
        clearTimeout(timer);
        timer = null;
        pending = null;
        return;
      }
      pending = valid;
      schedule(delayMs);
    },

    /** @param {Object} settings - Upload right away */
    saveNow(settings) {
      pending = pickSettings(settings);
      return send();
    },

    /**
     * Send pending changes now, e.g. before signing out
     * @returns {Promise<void>}
     */
    async flush() {
      if (inFlight) await inFlight;
      if (pending) await send();
    },

    /** Send pending changes while the page is hidden or closed */
    flushWithBeacon() {
      if (!pending || !beacon(pending)) return;
      // A request in flight may reach the server after the beacon: keep the change
      // pending, so it is sent again right after that request (if the page lives on)
      clearTimeout(timer);
      timer = null;
      if (inFlight) return;
      saved = JSON.stringify(pending);
      pending = null;
      failures = 0;
    },

    /** @returns {boolean} Whether a change still has to be sent */
    get dirty() {
      return pending !== null;
    }
  };
}

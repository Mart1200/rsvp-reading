/**
 * Keeps the reading position of a library text in sync with the server.
 *
 * The reader reports every position change with update(); flush() sends it when it differs
 * from what the server has. Failed requests are dropped silently: the position stays
 * unsynced and the next flush tries again. Requests are sent one after another, so the
 * server always ends up with the most recent position (last write wins).
 */

/** While playing, the position is saved at most this often */
export const PROGRESS_SYNC_INTERVAL_MS = 10_000;

/**
 * @param {Object} deps
 * @param {(id: string, position: number) => Promise<void>} deps.save - Regular request
 * @param {(id: string, position: number) => boolean} deps.beacon - Request that survives closing the page
 * @param {(id: string, position: number) => void} [deps.onSynced] - The server now has this position
 * @param {number} [deps.intervalMs]
 */
export function createProgressSync({
  save,
  beacon,
  onSynced = () => {},
  intervalMs = PROGRESS_SYNC_INTERVAL_MS
}) {
  /** @type {string|null} */
  let textId = null;
  // Position the server has, and the current reading position
  let synced = 0;
  let latest = 0;
  let timer = null;
  let queue = Promise.resolve(false);

  const isDirty = () => textId !== null && latest !== synced;

  /**
   * Send the current position if the server does not have it yet
   * @param {Object} [options]
   * @param {boolean} [options.force] - Send even when unchanged (manual save)
   * @returns {Promise<boolean>} Whether this request stored the position
   */
  function flush({ force = false } = {}) {
    if (textId === null || (!force && !isDirty())) return queue.then(() => false);
    const id = textId;
    const position = latest;

    queue = queue.then(async () => {
      // An earlier queued request may have stored it already
      if (!force && id === textId && position === synced) return false;
      try {
        await save(id, position);
      } catch {
        return false;
      }
      if (id === textId) synced = position;
      onSynced(id, position);
      return true;
    });
    return queue;
  }

  return {
    /**
     * Follow a library text whose stored position is known
     * @param {string} id
     * @param {number} position - Position the server has
     */
    link(id, position) {
      textId = id;
      synced = position;
      latest = position;
    },

    /** Stop following the text (unsynced changes are dropped; flush() first to keep them) */
    unlink() {
      textId = null;
      synced = latest = 0;
    },

    /** @param {number} position - Current reading position */
    update(position) {
      latest = position;
    },

    /** Forget unsynced changes, e.g. after going back to the saved position */
    discard() {
      latest = synced;
    },

    flush,

    /** Send unsynced changes while the page is hidden or closed */
    flushWithBeacon() {
      if (isDirty() && beacon(textId, latest)) {
        synced = latest;
        onSynced(textId, latest);
      }
    },

    /** Save periodically while playing */
    setPlaying(playing) {
      if (playing && !timer) {
        timer = setInterval(() => flush(), intervalMs);
      } else if (!playing && timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    /** @returns {boolean} Whether the current position still has to be sent */
    get dirty() {
      return isDirty();
    }
  };
}

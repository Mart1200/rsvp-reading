/**
 * Keeps the reading position of a library text in sync with the server.
 *
 * The reader reports every position change with update(); flush() sends it when it differs
 * from what the server has. Failed requests are dropped silently: the position stays
 * unsynced and the next flush tries again. Requests are sent one after another, and a
 * queued request sends the newest position when its turn comes, so the server always ends
 * up with the most recent position (last write wins).
 *
 * Some events make the result of a request still in flight meaningless: a beacon sent
 * meanwhile, going back to the saved position (discard) or opening a text (link). Those
 * bump a generation counter, and results of older generations no longer change the state.
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
  let generation = 0;
  let requestInFlight = false;
  // Beacon sent while a request was in flight: the server may process that older request
  // last, so the beacon's position is sent again afterwards
  /** @type {{id: string, position: number}|null} */
  let resend = null;

  const isDirty = () => textId !== null && latest !== synced;

  async function send(id, position) {
    const startedIn = generation;
    requestInFlight = true;
    let ok = true;
    try {
      await save(id, position);
    } catch {
      ok = false;
    } finally {
      requestInFlight = false;
    }

    if (startedIn !== generation) {
      if (resend) {
        const again = resend;
        resend = null;
        queue = queue.then(() => send(again.id, again.position));
      }
      return false;
    }
    if (!ok) return false;
    if (id === textId) synced = position;
    onSynced(id, position);
    return true;
  }

  /**
   * Send the current position if the server does not have it yet
   * @param {Object} [options]
   * @param {boolean} [options.force] - Send even when unchanged (manual save)
   * @returns {Promise<boolean>} Whether this request stored the position
   */
  function flush({ force = false } = {}) {
    if (textId === null || (!force && !isDirty())) return queue.then(() => false);
    const id = textId;
    const positionNow = latest;

    const run = queue.then(() => {
      // Still the open text: send its newest position
      const position = id === textId ? latest : positionNow;
      if (!force && id === textId && position === synced) return false;
      return send(id, position);
    });
    queue = run;
    return run;
  }

  return {
    /**
     * Follow a library text whose stored position is known
     * @param {string} id
     * @param {number} position - Position the server has
     */
    link(id, position) {
      generation++;
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
      generation++;
      latest = synced;
    },

    flush,

    /** Send unsynced changes while the page is hidden or closed */
    flushWithBeacon() {
      if (!isDirty() || !beacon(textId, latest)) return;
      if (requestInFlight) {
        generation++;
        resend = { id: textId, position: latest };
      }
      synced = latest;
      onSynced(textId, latest);
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

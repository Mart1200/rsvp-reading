// Sweep stale keys every N recorded hits so the map can't grow without bound
const SWEEP_EVERY = 1000;

/**
 * In-memory sliding-window rate limiter (single process).
 * @param {Object} options
 * @param {number} options.limit - Allowed hits per window
 * @param {number} options.windowMs - Window length in milliseconds
 * @param {() => number} [options.now] - Clock, injectable for tests
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  /** @type {Map<string, number[]>} key -> hit timestamps, oldest first */
  const hits = new Map();
  let hitsSinceSweep = 0;

  function recent(key, time) {
    const stamps = (hits.get(key) ?? []).filter((t) => t > time - windowMs);
    if (stamps.length > 0) hits.set(key, stamps);
    else hits.delete(key);
    return stamps;
  }

  function sweep(time) {
    for (const key of hits.keys()) recent(key, time);
  }

  return {
    /**
     * @param {string} key
     * @returns {{limited: boolean, retryAfterSeconds: number}}
     */
    check(key) {
      const time = now();
      const stamps = recent(key, time);
      if (stamps.length < limit) return { limited: false, retryAfterSeconds: 0 };
      const retryAfterMs = stamps[stamps.length - limit] + windowMs - time;
      return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },

    /** @param {string} key */
    hit(key) {
      const time = now();
      hits.set(key, [...recent(key, time), time]);
      if (++hitsSinceSweep >= SWEEP_EVERY) {
        hitsSinceSweep = 0;
        sweep(time);
      }
    },

    /** @param {string} key */
    reset(key) {
      hits.delete(key);
    },

    /** Number of tracked keys (for tests and monitoring) */
    get size() {
      return hits.size;
    }
  };
}

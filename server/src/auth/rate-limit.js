// Sweep stale keys every N recorded hits so the map can't grow without bound
const SWEEP_EVERY = 1000;

/**
 * Check several limiters and, only if none is exhausted, record a hit on each.
 * Synchronous on purpose: with no await between check and hit, concurrent
 * requests cannot all pass the check before the first hit is recorded.
 * @param {Array<[ReturnType<typeof createRateLimiter>, string]>} entries - [limiter, key] pairs
 * @returns {{limited: boolean, retryAfterSeconds: number}}
 */
export function consume(entries) {
  for (const [limiter, key] of entries) {
    const result = limiter.check(key);
    if (result.limited) return result;
  }
  for (const [limiter, key] of entries) limiter.hit(key);
  return { limited: false, retryAfterSeconds: 0 };
}

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

    /**
     * Remove the most recent hit, e.g. when a reserved attempt turned out to be legitimate
     * @param {string} key
     */
    undo(key) {
      const stamps = hits.get(key);
      if (!stamps) return;
      stamps.pop();
      if (stamps.length === 0) hits.delete(key);
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

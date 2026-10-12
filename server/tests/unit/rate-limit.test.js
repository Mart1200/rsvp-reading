import { describe, it, expect } from 'vitest';
import { createRateLimiter, consume } from '../../src/auth/rate-limit.js';

function limiterWithClock(options) {
  const clock = { time: 1_000_000 };
  const limiter = createRateLimiter({ ...options, now: () => clock.time });
  return { limiter, clock };
}

describe('createRateLimiter', () => {
  it('allows up to the limit within the window', () => {
    const { limiter } = limiterWithClock({ limit: 3, windowMs: 60_000 });

    for (let i = 0; i < 3; i++) {
      expect(limiter.check('k').limited).toBe(false);
      limiter.hit('k');
    }
    expect(limiter.check('k').limited).toBe(true);
  });

  it('tracks keys independently', () => {
    const { limiter } = limiterWithClock({ limit: 1, windowMs: 60_000 });
    limiter.hit('a');

    expect(limiter.check('a').limited).toBe(true);
    expect(limiter.check('b').limited).toBe(false);
  });

  it('frees up once the oldest hit leaves the window (sliding)', () => {
    const { limiter, clock } = limiterWithClock({ limit: 2, windowMs: 60_000 });
    limiter.hit('k');
    clock.time += 30_000;
    limiter.hit('k');

    clock.time += 29_999;
    expect(limiter.check('k').limited).toBe(true);
    clock.time += 1;
    expect(limiter.check('k').limited).toBe(false);
  });

  it('reports when the next attempt is allowed, rounded up to seconds', () => {
    const { limiter, clock } = limiterWithClock({ limit: 2, windowMs: 60_000 });
    limiter.hit('k');
    clock.time += 10_000;
    limiter.hit('k');
    clock.time += 500;

    expect(limiter.check('k')).toEqual({ limited: true, retryAfterSeconds: 50 });
  });

  it('never reports less than one second', () => {
    const { limiter, clock } = limiterWithClock({ limit: 1, windowMs: 1000 });
    limiter.hit('k');
    clock.time += 999.5;

    expect(limiter.check('k').retryAfterSeconds).toBe(1);
  });

  it('reset clears a key', () => {
    const { limiter } = limiterWithClock({ limit: 1, windowMs: 60_000 });
    limiter.hit('k');
    limiter.reset('k');

    expect(limiter.check('k').limited).toBe(false);
  });

  it('forgets keys whose hits have expired', () => {
    const { limiter, clock } = limiterWithClock({ limit: 5, windowMs: 1000 });
    limiter.hit('a');
    limiter.hit('b');
    expect(limiter.size).toBe(2);

    clock.time += 1000;
    limiter.check('a');
    expect(limiter.size).toBe(1);
  });

  it('periodically sweeps stale keys so memory stays bounded', () => {
    const { limiter, clock } = limiterWithClock({ limit: 5, windowMs: 1000 });
    for (let i = 0; i < 500; i++) limiter.hit(`old-${i}`);

    clock.time += 1000;
    for (let i = 0; i < 500; i++) limiter.hit(`new-${i}`);

    expect(limiter.size).toBe(500);
  });
});

describe('undo', () => {
  it('removes only the most recent hit', () => {
    const { limiter } = limiterWithClock({ limit: 2, windowMs: 60_000 });
    limiter.hit('k');
    limiter.hit('k');

    limiter.undo('k');

    expect(limiter.check('k').limited).toBe(false);
    limiter.hit('k');
    expect(limiter.check('k').limited).toBe(true);
  });

  it('is a no-op for unknown keys', () => {
    const { limiter } = limiterWithClock({ limit: 1, windowMs: 60_000 });

    expect(() => limiter.undo('nope')).not.toThrow();
    expect(limiter.size).toBe(0);
  });
});

describe('consume', () => {
  it('records a hit on every limiter when none is exhausted', () => {
    const { limiter: a } = limiterWithClock({ limit: 1, windowMs: 60_000 });
    const { limiter: b } = limiterWithClock({ limit: 1, windowMs: 60_000 });

    expect(consume([[a, 'x'], [b, 'y']])).toEqual({ limited: false, retryAfterSeconds: 0 });
    expect(a.check('x').limited).toBe(true);
    expect(b.check('y').limited).toBe(true);
  });

  it('records nothing when any limiter is exhausted', () => {
    const { limiter: a } = limiterWithClock({ limit: 5, windowMs: 60_000 });
    const { limiter: b } = limiterWithClock({ limit: 1, windowMs: 60_000 });
    b.hit('y');

    expect(consume([[a, 'x'], [b, 'y']]).limited).toBe(true);
    expect(a.size).toBe(0);
  });

  it('lets exactly `limit` callers through even when called back to back', () => {
    const { limiter } = limiterWithClock({ limit: 3, windowMs: 60_000 });

    const results = Array.from({ length: 10 }, () => consume([[limiter, 'k']]).limited);

    expect(results.filter((limited) => !limited)).toHaveLength(3);
  });
});

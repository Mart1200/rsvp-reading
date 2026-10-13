import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressSync, PROGRESS_SYNC_INTERVAL_MS } from '../lib/progress-sync.js';

function setup({ save = vi.fn().mockResolvedValue(undefined), beacon = vi.fn(() => true) } = {}) {
  const onSynced = vi.fn();
  const sync = createProgressSync({ save, beacon, onSynced });
  return { sync, save, beacon, onSynced };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createProgressSync', () => {
  it('sends nothing without a linked text', async () => {
    const { sync, save, beacon } = setup();

    sync.update(5);
    await sync.flush({ force: true });
    sync.flushWithBeacon();

    expect(save).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('sends only changed positions', async () => {
    const { sync, save, onSynced } = setup();
    sync.link('t1', 10);

    expect(await sync.flush()).toBe(false);
    sync.update(12);
    expect(await sync.flush()).toBe(true);
    expect(await sync.flush()).toBe(false);

    expect(save).toHaveBeenCalledExactlyOnceWith('t1', 12);
    expect(onSynced).toHaveBeenCalledExactlyOnceWith('t1', 12);
  });

  it('sends unchanged positions when forced', async () => {
    const { sync, save } = setup();
    sync.link('t1', 10);

    await sync.flush({ force: true });

    expect(save).toHaveBeenCalledWith('t1', 10);
  });

  it('keeps a failed position for the next flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { sync, onSynced } = setup({ save });
    sync.link('t1', 0);
    sync.update(7);

    expect(await sync.flush()).toBe(false);
    expect(sync.dirty).toBe(true);
    expect(onSynced).not.toHaveBeenCalled();

    expect(await sync.flush()).toBe(true);
    expect(save).toHaveBeenLastCalledWith('t1', 7);
    expect(sync.dirty).toBe(false);
  });

  it('sends one request at a time, in order', async () => {
    const order = [];
    let release;
    const save = vi.fn((id, position) => {
      order.push(`start ${position}`);
      return new Promise((resolve) => { release = () => { order.push(`end ${position}`); resolve(); }; });
    });
    const { sync } = setup({ save });
    sync.link('t1', 0);

    sync.update(1);
    const first = sync.flush();
    sync.update(2);
    const second = sync.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    release();
    await first;
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    release();
    await second;

    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('skips a queued request that an earlier one already covered', async () => {
    const { sync, save } = setup();
    sync.link('t1', 0);
    sync.update(3);

    await Promise.all([sync.flush(), sync.flush()]);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('discard() goes back to the synced position', async () => {
    const { sync, save } = setup();
    sync.link('t1', 10);
    sync.update(30);

    sync.discard();
    await sync.flush();

    expect(sync.dirty).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('finishes a flush for the previous text after switching', async () => {
    const { sync, save, onSynced } = setup();
    sync.link('t1', 0);
    sync.update(5);

    const pending = sync.flush();
    sync.link('t2', 40);
    await pending;

    expect(save).toHaveBeenCalledWith('t1', 5);
    expect(onSynced).toHaveBeenCalledWith('t1', 5);
    expect(sync.dirty).toBe(false);
  });

  it('unlink() drops unsynced changes', async () => {
    const { sync, save } = setup();
    sync.link('t1', 0);
    sync.update(5);

    sync.unlink();
    await sync.flush();

    expect(save).not.toHaveBeenCalled();
  });

  describe('flushWithBeacon', () => {
    it('sends unsynced changes with a beacon', () => {
      const { sync, beacon, onSynced } = setup();
      sync.link('t1', 0);
      sync.update(9);

      sync.flushWithBeacon();
      sync.flushWithBeacon();

      expect(beacon).toHaveBeenCalledExactlyOnceWith('t1', 9);
      expect(onSynced).toHaveBeenCalledWith('t1', 9);
    });

    it('keeps the change when the browser refuses the beacon', () => {
      const { sync } = setup({ beacon: vi.fn(() => false) });
      sync.link('t1', 0);
      sync.update(9);

      sync.flushWithBeacon();

      expect(sync.dirty).toBe(true);
    });
  });

  describe('setPlaying', () => {
    it('saves changes periodically while playing', async () => {
      const { sync, save } = setup();
      sync.link('t1', 0);
      sync.setPlaying(true);
      sync.setPlaying(true);

      sync.update(4);
      await vi.advanceTimersByTimeAsync(PROGRESS_SYNC_INTERVAL_MS - 1);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledExactlyOnceWith('t1', 4);

      // Nothing changed since
      await vi.advanceTimersByTimeAsync(PROGRESS_SYNC_INTERVAL_MS);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('stops saving when no longer playing', async () => {
      const { sync, save } = setup();
      sync.link('t1', 0);
      sync.setPlaying(true);
      sync.setPlaying(false);

      sync.update(4);
      await vi.advanceTimersByTimeAsync(PROGRESS_SYNC_INTERVAL_MS * 3);

      expect(save).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSettingsSync, pickSettings, DEFAULT_SETTINGS, SETTING_TYPES,
  SETTINGS_SYNC_DELAY_MS, SETTINGS_RETRY_DELAYS_MS
} from '../lib/settings-sync.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DEFAULT_SETTINGS', () => {
  it('has exactly the settings the server accepts, all valid', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(Object.keys(SETTING_TYPES).sort());
    expect(pickSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('pickSettings', () => {
  it('keeps known, valid settings only', () => {
    expect(pickSettings({
      wordsPerMinute: 400,
      fadeEnabled: false,
      fadeDuration: '150',
      frameWordCount: NaN,
      pauseDuration: 1e9,
      pauseAfterWords: -1,
      theme: 'dark'
    })).toEqual({ wordsPerMinute: 400, fadeEnabled: false });
  });

  it.each([null, undefined, 'x', 42])('returns {} for %s', (value) => {
    expect(pickSettings(value)).toEqual({});
  });
});

describe('createSettingsSync', () => {
  function setup({ save = vi.fn().mockResolvedValue(undefined), beacon = vi.fn(() => true) } = {}) {
    return { sync: createSettingsSync({ save, beacon }), save, beacon };
  }

  // A save() whose requests finish only when released, in order
  function controlledSave() {
    const releases = [];
    const save = vi.fn(() => new Promise((resolve, reject) => releases.push({ resolve, reject })));
    return { save, release: () => releases.shift().resolve(), fail: () => releases.shift().reject(new Error('offline')) };
  }

  it('saves after the delay, once for a burst of changes', async () => {
    const { sync, save } = setup();
    sync.reset({ wordsPerMinute: 300 });

    sync.changed({ wordsPerMinute: 325 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS - 1);
    sync.changed({ wordsPerMinute: 350 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({ wordsPerMinute: 350 });
  });

  it('skips settings the server already has', async () => {
    const { sync, save } = setup();
    sync.reset({ wordsPerMinute: 300 });

    sync.changed({ wordsPerMinute: 325 });
    sync.changed({ wordsPerMinute: 300 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);

    expect(save).not.toHaveBeenCalled();
  });

  it('never uploads unknown or invalid settings', async () => {
    const { sync, save } = setup();

    sync.changed({ wordsPerMinute: 325, theme: 'dark', fadeDuration: -5 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS);

    expect(save).toHaveBeenCalledWith({ wordsPerMinute: 325 });
  });

  it('reset() drops a pending save', async () => {
    const { sync, save } = setup();

    sync.changed({ wordsPerMinute: 325 });
    sync.reset({ wordsPerMinute: 400 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);

    expect(save).not.toHaveBeenCalled();
  });

  it('saveNow() saves immediately', () => {
    const { sync, save } = setup();

    sync.saveNow({ wordsPerMinute: 300 });

    expect(save).toHaveBeenCalledWith({ wordsPerMinute: 300 });
  });

  it('sends one request at a time and the newest settings last', async () => {
    const { save, release } = controlledSave();
    const { sync } = setup({ save });

    sync.saveNow({ wordsPerMinute: 400 });
    sync.changed({ wordsPerMinute: 500 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({ wordsPerMinute: 500 });
  });

  it('sends nothing more when a change matches the settings in flight', async () => {
    const { save, release } = controlledSave();
    const { sync } = setup({ save });

    sync.saveNow({ wordsPerMinute: 400 });
    sync.changed({ wordsPerMinute: 400 });
    release();
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);

    expect(save).toHaveBeenCalledTimes(1);
    expect(sync.dirty).toBe(false);
  });

  it('retries a failed upload with a backoff', async () => {
    const { save, fail, release } = controlledSave();
    const { sync } = setup({ save });

    sync.saveNow({ wordsPerMinute: 400 });
    fail();
    await vi.advanceTimersByTimeAsync(SETTINGS_RETRY_DELAYS_MS[0] - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);

    fail();
    await vi.advanceTimersByTimeAsync(SETTINGS_RETRY_DELAYS_MS[1]);
    expect(save).toHaveBeenCalledTimes(3);
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(sync.dirty).toBe(false);
    expect(save).toHaveBeenLastCalledWith({ wordsPerMinute: 400 });
  });

  it('flush() sends a pending change right away and waits for it', async () => {
    const { sync, save } = setup();
    sync.reset({ wordsPerMinute: 300 });
    sync.changed({ wordsPerMinute: 325 });

    await sync.flush();

    expect(save).toHaveBeenCalledWith({ wordsPerMinute: 325 });
    expect(sync.dirty).toBe(false);
  });

  describe('flushWithBeacon', () => {
    it('sends a pending change with a beacon instead of waiting', async () => {
      const { sync, save, beacon } = setup();
      sync.reset({ wordsPerMinute: 300 });
      sync.changed({ wordsPerMinute: 325 });

      sync.flushWithBeacon();
      await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);

      expect(beacon).toHaveBeenCalledExactlyOnceWith({ wordsPerMinute: 325 });
      expect(save).not.toHaveBeenCalled();
    });

    it('does nothing without a pending change', () => {
      const { sync, beacon } = setup();

      sync.flushWithBeacon();

      expect(beacon).not.toHaveBeenCalled();
    });

    it('sends the change again after a request in flight, which may arrive later', async () => {
      const { save, release } = controlledSave();
      const { sync, beacon } = setup({ save });
      sync.saveNow({ wordsPerMinute: 400 });
      sync.changed({ wordsPerMinute: 500 });

      sync.flushWithBeacon();
      release();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

      expect(beacon).toHaveBeenCalledWith({ wordsPerMinute: 500 });
      expect(save).toHaveBeenLastCalledWith({ wordsPerMinute: 500 });
    });
  });
});

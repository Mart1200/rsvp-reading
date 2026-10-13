import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSettingsSync, pickSettings, SETTINGS_SYNC_DELAY_MS } from '../lib/settings-sync.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pickSettings', () => {
  it('keeps known, well-typed settings only', () => {
    expect(pickSettings({
      wordsPerMinute: 400,
      fadeEnabled: false,
      fadeDuration: '150',
      frameWordCount: NaN,
      theme: 'dark'
    })).toEqual({ wordsPerMinute: 400, fadeEnabled: false });
  });

  it.each([null, undefined, 'x', 42])('returns {} for %s', (value) => {
    expect(pickSettings(value)).toEqual({});
  });
});

describe('createSettingsSync', () => {
  function setup(save = vi.fn().mockResolvedValue(undefined)) {
    return { sync: createSettingsSync({ save }), save };
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

  it('reset() and cancel() drop a pending save', async () => {
    const { sync, save } = setup();

    sync.changed({ wordsPerMinute: 325 });
    sync.reset({ wordsPerMinute: 400 });
    sync.changed({ wordsPerMinute: 500 });
    sync.cancel();
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS * 2);

    expect(save).not.toHaveBeenCalled();
  });

  it('saveNow() saves immediately', () => {
    const { sync, save } = setup();

    sync.saveNow({ wordsPerMinute: 300 });

    expect(save).toHaveBeenCalledWith({ wordsPerMinute: 300 });
  });

  it('tries again with the next change after a failure', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { sync } = setup(save);

    sync.saveNow({ wordsPerMinute: 300 });
    await vi.advanceTimersByTimeAsync(0);
    sync.changed({ wordsPerMinute: 300 });
    await vi.advanceTimersByTimeAsync(SETTINGS_SYNC_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(2);
  });
});

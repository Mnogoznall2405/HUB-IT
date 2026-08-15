import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSWRCache,
  peekSWRCache,
  setSWRCache,
  trimSWRCache,
} from './swrCache';

describe('swrCache memory bounds', () => {
  beforeEach(() => {
    clearSWRCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T12:00:00Z'));
  });

  afterEach(() => {
    clearSWRCache();
    vi.useRealTimers();
  });

  it('keeps at most 80 least-recently-used entries', () => {
    for (let index = 0; index < 80; index += 1) {
      setSWRCache(['item', index], index);
    }
    expect(peekSWRCache(['item', 0])?.data).toBe(0);

    setSWRCache(['item', 80], 80);

    expect(peekSWRCache(['item', 1])).toBeNull();
    expect(peekSWRCache(['item', 0])?.data).toBe(0);
    expect(peekSWRCache(['item', 80])?.data).toBe(80);
  });

  it('removes entries older than 30 minutes', () => {
    setSWRCache(['mail', 'detail'], { id: 1 });
    vi.advanceTimersByTime((30 * 60 * 1000) + 1);

    expect(peekSWRCache(['mail', 'detail'])).toBeNull();
  });

  it('can trim to the 16 most recent entries in background mode', () => {
    for (let index = 0; index < 20; index += 1) {
      setSWRCache(['thread', index], index);
    }

    trimSWRCache({ maxEntries: 16 });

    expect(peekSWRCache(['thread', 3])).toBeNull();
    expect(peekSWRCache(['thread', 4])?.data).toBe(4);
    expect(peekSWRCache(['thread', 19])?.data).toBe(19);
  });
});

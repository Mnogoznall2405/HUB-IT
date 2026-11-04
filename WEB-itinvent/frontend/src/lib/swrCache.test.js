import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSWRCache,
  getOrFetchSWR,
  invalidateSWRCacheByPrefix,
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

describe('swrCache session boundaries', () => {
  it.each(['old-first', 'new-first'])('fences old fetches across clear (%s)', async (order) => {
    clearSWRCache();
    let resolveOld;
    let resolveNew;
    const oldFetcher = vi.fn(() => new Promise((resolve) => { resolveOld = resolve; }));
    const newFetcher = vi.fn(() => new Promise((resolve) => { resolveNew = resolve; }));
    const oldRequest = getOrFetchSWR('shared-key', oldFetcher);
    await Promise.resolve();
    clearSWRCache();
    const newRequest = getOrFetchSWR('shared-key', newFetcher);
    await Promise.resolve();

    if (order === 'old-first') {
      resolveOld('user-A');
      await oldRequest;
      expect(peekSWRCache('shared-key')).toBeNull();
      const concurrent = getOrFetchSWR('shared-key', newFetcher);
      await Promise.resolve();
      expect(newFetcher).toHaveBeenCalledTimes(1);
      resolveNew('user-B');
      await Promise.all([newRequest, concurrent]);
    } else {
      resolveNew('user-B');
      await newRequest;
      resolveOld('user-A');
      await oldRequest;
    }
    expect(peekSWRCache('shared-key').data).toBe('user-B');
    clearSWRCache();
  });
});

describe('swrCache invalidation vs in-flight reads', () => {
  beforeEach(() => clearSWRCache());
  afterEach(() => clearSWRCache());

  it('refetches after invalidation instead of joining a read that started before the mutation', async () => {
    let resolveOld;
    const oldFetcher = vi.fn(() => new Promise((resolve) => { resolveOld = resolve; }));
    const newFetcher = vi.fn(async () => 'NEW');

    const oldRead = getOrFetchSWR(['networks', 'ctx', 1], oldFetcher);
    invalidateSWRCacheByPrefix('networks', 'ctx', 1);
    const afterMutation = await getOrFetchSWR(['networks', 'ctx', 1], newFetcher, { force: true });
    resolveOld('OLD');
    await oldRead;

    expect(afterMutation.data).toBe('NEW');
    expect(newFetcher).toHaveBeenCalledTimes(1);
    expect(peekSWRCache(['networks', 'ctx', 1])?.data).toBe('NEW');
  });
});

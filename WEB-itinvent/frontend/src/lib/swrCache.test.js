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

describe('swrCache force vs in-flight reads', () => {
  beforeEach(() => clearSWRCache());
  afterEach(() => clearSWRCache());

  it('force does not join a non-forced in-flight read — refresh guarantees a fetch', async () => {
    let resolveOld;
    const slowFetcher = vi.fn(() => new Promise((resolve) => { resolveOld = resolve; }));
    const refreshFetcher = vi.fn(async () => 'FRESH');

    const pending = getOrFetchSWR('key', slowFetcher);
    const refreshed = await getOrFetchSWR('key', refreshFetcher, { force: true });

    expect(refreshFetcher).toHaveBeenCalledTimes(1);
    expect(refreshed.data).toBe('FRESH');
    expect(peekSWRCache('key').data).toBe('FRESH');

    // The detached read must not overwrite the forced result when it lands.
    resolveOld('STALE-LATE');
    await pending;
    expect(peekSWRCache('key').data).toBe('FRESH');
  });

  it('non-forced reads still join an in-flight forced refresh', async () => {
    let resolveRefresh;
    const refreshFetcher = vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const joinFetcher = vi.fn(async () => 'JOINED');

    const forced = getOrFetchSWR('key', refreshFetcher, { force: true });
    const joined = getOrFetchSWR('key', joinFetcher);
    await Promise.resolve();
    resolveRefresh('FRESH');
    const [a, b] = await Promise.all([forced, joined]);

    expect(joinFetcher).not.toHaveBeenCalled();
    expect(a.data).toBe('FRESH');
    expect(b.data).toBe('FRESH');
  });
});

describe('swrCache stale revalidation delivery', () => {
  beforeEach(() => clearSWRCache());
  afterEach(() => clearSWRCache());

  it('delivers the background refetch via onRevalidated when it publishes', async () => {
    setSWRCache('key', 'OLD');
    const fetcher = vi.fn(async () => 'NEW');
    const onRevalidated = vi.fn();

    const result = await getOrFetchSWR('key', fetcher, { staleTimeMs: -1, onRevalidated });
    expect(result).toEqual({ data: 'OLD', fromCache: true, isFresh: false });

    await vi.waitFor(() => expect(onRevalidated).toHaveBeenCalledWith('NEW'));
    expect(peekSWRCache('key').data).toBe('NEW');
  });

  it('does not deliver a detached refetch (invalidation wins)', async () => {
    const keyParts = ['reval', 'key'];
    setSWRCache(keyParts, 'OLD');
    let resolveFetch;
    const fetcher = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const onRevalidated = vi.fn();

    const result = await getOrFetchSWR(keyParts, fetcher, { staleTimeMs: -1, onRevalidated });
    expect(result.fromCache).toBe(true);

    invalidateSWRCacheByPrefix('reval');
    resolveFetch('DISCARDED');
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(onRevalidated).not.toHaveBeenCalled();
    expect(peekSWRCache(keyParts)).toBeNull();
  });
});

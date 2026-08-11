import { describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_FINGERPRINT_KEY,
  ROUTE_CHUNK_RELOAD_KEY,
  buildChunkReloadFingerprint,
  clearRouteChunkRecoveryState,
  isRouteChunkLoadError,
  tryRecoverChunkLoad,
} from './routeChunkRecovery';

describe('routeChunkRecovery', () => {
  it('detects stale route chunk errors', () => {
    expect(isRouteChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isRouteChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isRouteChunkLoadError(new Error('Something else'))).toBe(false);
  });

  it('clears recovery markers from session storage', () => {
    const removeItem = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: {
        removeItem,
      },
    });

    clearRouteChunkRecoveryState();

    expect(removeItem).toHaveBeenCalledWith(ROUTE_CHUNK_RELOAD_KEY);
    expect(removeItem).toHaveBeenCalledWith(CHUNK_RELOAD_FINGERPRINT_KEY);
    vi.unstubAllGlobals();
  });

  it('fingerprints chunk recovery by route only to avoid reload loops', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/chat',
        search: '?conversation=7',
      },
    });

    expect(buildChunkReloadFingerprint('Failed to fetch .../Chat-aaa.js'))
      .toBe('/chat?conversation=7');
    expect(buildChunkReloadFingerprint('Failed to fetch .../Chat-bbb.js'))
      .toBe('/chat?conversation=7');
    vi.unstubAllGlobals();
  });

  it('recovers a chunk load once per route fingerprint', () => {
    const reload = vi.fn();
    const store = new Map();
    vi.stubGlobal('window', {
      location: {
        pathname: '/chat',
        search: '?conversation=7',
        reload,
      },
      sessionStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
      },
    });

    expect(tryRecoverChunkLoad('Failed to fetch .../Chat-aaa.js')).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(tryRecoverChunkLoad('Failed to fetch .../Chat-bbb.js')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('detects analytics lazy chunk load failures for F030 recovery', async () => {
    expect(isRouteChunkLoadError(new Error('Loading chunk recharts failed'))).toBe(true);
    const { preloadTasksAnalyticsView } = await import('../components/hub/tasks/TasksDataModeRouter');
    await expect(preloadTasksAnalyticsView()).resolves.toBeTruthy();
  });
});

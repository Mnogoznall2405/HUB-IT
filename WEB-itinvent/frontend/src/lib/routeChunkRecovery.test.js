import { describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_FINGERPRINT_KEY,
  ROUTE_CHUNK_RELOAD_KEY,
  clearRouteChunkRecoveryState,
  isRouteChunkLoadError,
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

  it('detects analytics lazy chunk load failures for F030 recovery', async () => {
    expect(isRouteChunkLoadError(new Error('Loading chunk recharts failed'))).toBe(true);
    const { preloadTasksAnalyticsView } = await import('../components/hub/tasks/TasksDataModeRouter');
    await expect(preloadTasksAnalyticsView()).resolves.toBeTruthy();
  });
});

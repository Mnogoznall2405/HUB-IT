import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getStartupRoutePrefetchPath,
  loadRouteWithReloadFallback,
  normalizeRouteLoaderPath,
  prefetchRouteByPath,
} from './routeLoaders';

describe('route loader startup prefetch', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        pathname: '/chat',
        search: '?conversation=conv-1',
        reload: vi.fn(),
      },
    });
    window.sessionStorage.clear();
  });

  it('normalizes network detail routes to the shared networks chunk', () => {
    expect(normalizeRouteLoaderPath('/networks/msk')).toBe('/networks');
    expect(getStartupRoutePrefetchPath('/networks/msk')).toBe('/networks');
  });

  it('prefetches known first-screen route chunks only', () => {
    expect(getStartupRoutePrefetchPath('/dashboard')).toBe('/dashboard');
    expect(getStartupRoutePrefetchPath('/database')).toBe('/database');
    expect(getStartupRoutePrefetchPath('/')).toBe('');
    expect(getStartupRoutePrefetchPath('/unknown')).toBe('');
  });

  it('does not reload the current chat route when a prefetch chunk request fails', async () => {
    await expect(prefetchRouteByPath('/tasks')).resolves.toBeNull();

    expect(window.location.reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('itinvent:route-chunk-reload-attempted')).toBeNull();
  });

  it('keeps chunk reload fallback for real route loads', async () => {
    const chunkError = new TypeError('Failed to fetch dynamically imported module');
    const pending = loadRouteWithReloadFallback(() => Promise.reject(chunkError));

    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('itinvent:route-chunk-reload-attempted')).toBe('1');
    await expect(Promise.race([pending, Promise.resolve('pending')])).resolves.toBe('pending');
  });
});

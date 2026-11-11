import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncAppBadge } from './appBadge';

describe('syncAppBadge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets badge in the page and forwards the count to the service worker', async () => {
    const setAppBadge = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    Object.defineProperty(globalThis.navigator, 'setAppBadge', {
      configurable: true,
      value: setAppBadge,
    });
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          active: { postMessage },
        }),
        controller: null,
      },
    });

    const synced = await syncAppBadge(4);

    expect(synced).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(4);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'itinvent:sync-app-badge',
      count: 4,
    });
  });

  it('clears badge and notifies the service worker with zero', async () => {
    const clearAppBadge = vi.fn().mockResolvedValue(undefined);
    const postMessage = vi.fn();
    Object.defineProperty(globalThis.navigator, 'setAppBadge', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis.navigator, 'clearAppBadge', {
      configurable: true,
      value: clearAppBadge,
    });
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          active: { postMessage },
        }),
        controller: null,
      },
    });

    const synced = await syncAppBadge(0);

    expect(synced).toBe(true);
    expect(clearAppBadge).toHaveBeenCalledWith();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'itinvent:sync-app-badge',
      count: 0,
    });
  });
});

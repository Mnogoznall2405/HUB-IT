import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

function worker(fetchImpl, cached) {
  const listeners = {};
  const cache = { match: vi.fn(async () => cached), put: vi.fn() };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn() };
  const self = { location: { origin: 'https://hub.test' }, skipWaiting: vi.fn(), addEventListener: (name, fn) => { listeners[name] = fn; } };
  const source = fs.readFileSync('public/sw.js', 'utf8');
  const exports = new Function('self', 'caches', 'fetch', `${source}; return { handleNavigationRequest, cleanupOldCaches };`)(self, caches, fetchImpl);
  return { ...exports, self, listeners, caches };
}

describe('PWA update and navigation recovery', () => {
  it('does not replace an existing worker until the update is applied', async () => {
    const w = worker(vi.fn().mockRejectedValue(new Error('offline')));
    let installed;
    w.listeners.install({ waitUntil: (promise) => { installed = promise; } });
    await installed;
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504])('uses the cached shell on HTTP %s', async (status) => {
    const cached = new Response('cached shell');
    const w = worker(async () => new Response('unavailable', { status }), cached);
    const response = await w.handleNavigationRequest(new Request('https://hub.test/tasks'), {});
    expect(await response.text()).toBe('cached shell');
  });

  it('preserves access errors instead of masking them with a cached shell', async () => {
    const w = worker(async () => new Response('forbidden', { status: 403 }), new Response('cached'));
    expect((await w.handleNavigationRequest(new Request('https://hub.test/tasks'), {})).status).toBe(403);
  });

  it('cleans only owned caches', async () => {
    const w = worker(vi.fn());
    w.caches.keys.mockResolvedValue(['another-app-cache', 'hubit-app-assets-old']);
    await w.cleanupOldCaches();
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith('hubit-app-assets-old');
  });
});

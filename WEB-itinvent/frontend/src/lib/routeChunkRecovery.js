export const ROUTE_CHUNK_RELOAD_KEY = 'itinvent:route-chunk-reload-attempted';
export const CHUNK_RELOAD_FINGERPRINT_KEY = 'itinvent_chunk_reload_fingerprint';
export const HARD_RELOAD_TEARDOWN_KEY = 'itinvent:hard-reload-teardown';
const HARD_RELOAD_TEARDOWN_WINDOW_MS = 5 * 60 * 1000;
// Only caches created by this app; foreign CacheStorage entries survive.
const APP_CACHE_PREFIXES = ['hubit-', 'itinvent-'];

export function isAppCacheKey(key) {
  return APP_CACHE_PREFIXES.some((prefix) => String(key || '').startsWith(prefix));
}

export function isRouteChunkLoadError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module')
    || message.includes('importing a module script failed')
    || message.includes('loading chunk')
    || message.includes('chunkloaderror')
    || message.includes('vite:preloaderror')
  );
}

export function clearRouteChunkRecoveryState() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ROUTE_CHUNK_RELOAD_KEY);
    window.sessionStorage.removeItem(CHUNK_RELOAD_FINGERPRINT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function buildChunkReloadFingerprint(reason = '') {
  if (typeof window === 'undefined') return '';
  // Fingerprint by route only. Including the full error reason caused reload
  // loops on mobile: each failed chunk URL produced a new fingerprint.
  // Pathname only. Search params on /tasks and /chat change during bootstrap
  // (task_view, conversation, task_layout) and would otherwise allow another
  // reload after every query rewrite.
  const route = String(window.location.pathname || '').trim() || '/';
  void reason;
  return route;
}

export function tryRecoverChunkLoad(reason = '') {
  if (typeof window === 'undefined') return false;
  try {
    const fingerprint = buildChunkReloadFingerprint(reason);
    const previousFingerprint = String(window.sessionStorage.getItem(CHUNK_RELOAD_FINGERPRINT_KEY) || '').trim();
    if (previousFingerprint !== fingerprint) {
      window.sessionStorage.setItem(CHUNK_RELOAD_FINGERPRINT_KEY, fingerprint);
      window.location.reload();
      return true;
    }
  } catch (error) {
    console.error('Chunk reload recovery failed', error);
  }
  return false;
}

// The destructive teardown runs at most once per window: when the first
// teardown+reload did not fix the load, a second one cannot help either —
// repeated Обновить clicks degrade to a plain reload instead of nuking
// caches again.
function markHardReloadTeardown() {
  try {
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(HARD_RELOAD_TEARDOWN_KEY) || 0);
    if (previous && now - previous < HARD_RELOAD_TEARDOWN_WINDOW_MS) return false;
    window.sessionStorage.setItem(HARD_RELOAD_TEARDOWN_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

export async function forceAppHardReload() {
  if (typeof window === 'undefined') return;

  clearRouteChunkRecoveryState();

  if (markHardReloadTeardown()) {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch (error) {
        console.error('Service worker unregister failed during hard reload', error);
      }
    }

    if ('caches' in window) {
      try {
        const keys = await window.caches.keys();
        await Promise.all(
          keys.filter(isAppCacheKey).map((key) => window.caches.delete(key)),
        );
      } catch (error) {
        console.error('Cache clear failed during hard reload', error);
      }
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set('__refresh', String(Date.now()));
  window.location.replace(url.toString());
}

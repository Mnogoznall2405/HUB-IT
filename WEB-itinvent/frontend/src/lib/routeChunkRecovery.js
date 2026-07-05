export const ROUTE_CHUNK_RELOAD_KEY = 'itinvent:route-chunk-reload-attempted';
export const CHUNK_RELOAD_FINGERPRINT_KEY = 'itinvent_chunk_reload_fingerprint';

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
  const route = `${window.location.pathname}${window.location.search}`;
  const normalizedReason = String(reason || '').trim().slice(0, 240);
  return normalizedReason ? `${route}::${normalizedReason}` : route;
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

export async function forceAppHardReload() {
  if (typeof window === 'undefined') return;

  clearRouteChunkRecoveryState();

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
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    } catch (error) {
      console.error('Cache clear failed during hard reload', error);
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set('__refresh', String(Date.now()));
  window.location.replace(url.toString());
}

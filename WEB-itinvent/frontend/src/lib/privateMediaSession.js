const SESSION_MESSAGE = 'itinvent:private-media-session';
const MEDIA_CACHE_PREFIX = 'hubit-chat-media-';
const ACK_TIMEOUT_MS = 2000;
let pendingSynchronization = Promise.resolve(true);

async function clearMediaCaches() {
  if (typeof caches === 'undefined') return true;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(MEDIA_CACHE_PREFIX)).map((key) => caches.delete(key)));
    return true;
  } catch {
    return false;
  }
}

async function synchronize(userKey, clear) {
  let target = null;
  try {
    target = navigator.serviceWorker?.controller
      || (await navigator.serviceWorker?.getRegistration?.())?.active;
  } catch {
    // CacheStorage cleanup also works without a controlling worker.
  }
  if (!target || typeof MessageChannel === 'undefined') return clearMediaCaches();
  const acknowledged = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (value) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), ACK_TIMEOUT_MS);
    channel.port1.onmessage = (event) => finish(event.data?.ok === true);
    try {
      target.postMessage({ type: SESSION_MESSAGE, user_key: userKey, clear }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
  if (acknowledged === true) return true;
  // Older workers do not know the account-scoping message. Remove their
  // unscoped media cache, keeping app assets and unrelated stores intact.
  const cleared = await clearMediaCaches();
  return acknowledged === null ? cleared : false;
}

export function synchronizePrivateMediaSession(userKey = '', { clear = false } = {}) {
  const key = String(userKey || '').trim().slice(0, 160);
  const operation = pendingSynchronization.then(() => synchronize(key, Boolean(clear))).catch(() => false);
  pendingSynchronization = operation;
  return operation;
}

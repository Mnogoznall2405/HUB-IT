/**
 * Keyed in-flight + dirty trailing refresh.
 * Same key joins the in-flight request; invalidate marks dirty → one trailing rerun.
 * Different keys must not be coalesced.
 */

export function createKeyedInFlightController() {
  /** @type {Map<string, { dirty: boolean, promise: Promise<any> }>} */
  const inflight = new Map();

  const run = (key, factory) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || typeof factory !== 'function') {
      return Promise.resolve(factory?.());
    }
    const existing = inflight.get(normalizedKey);
    if (existing?.promise) {
      existing.dirty = true;
      return existing.promise;
    }
    const entry = { dirty: false, promise: null };
    const promise = (async () => {
      let lastResult;
      let isTrailing = false;
      try {
        do {
          entry.dirty = false;
          lastResult = await factory({ isTrailing });
          isTrailing = true;
        } while (entry.dirty);
        return lastResult;
      } finally {
        if (inflight.get(normalizedKey) === entry) {
          inflight.delete(normalizedKey);
        }
      }
    })();
    entry.promise = promise;
    inflight.set(normalizedKey, entry);
    return promise;
  };

  const markDirty = (key) => {
    const entry = inflight.get(String(key || '').trim());
    if (entry) entry.dirty = true;
  };

  const isInFlight = (key) => inflight.has(String(key || '').trim());

  return { run, markDirty, isInFlight };
}

export function buildConversationsInFlightKey({
  userCacheId = '',
  folder = '',
  search = '',
  cursor = '',
} = {}) {
  return [
    'chat-conversations',
    String(userCacheId || '').trim(),
    String(folder || '').trim(),
    String(search || '').trim(),
    String(cursor || '').trim() || 'head',
  ].join('|');
}

export function buildHistoryInFlightKey({
  conversationId = '',
  cursor = '',
  direction = '',
  limit = 0,
} = {}) {
  return [
    'chat-history',
    String(conversationId || '').trim(),
    String(direction || 'latest').trim(),
    String(cursor || '').trim() || 'none',
    String(Number(limit) || 0),
  ].join('|');
}

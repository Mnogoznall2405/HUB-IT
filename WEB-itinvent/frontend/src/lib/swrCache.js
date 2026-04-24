const cacheStore = new Map();
const inFlightStore = new Map();

const DEFAULT_STALE_TIME_MS = 30_000;

const toCacheKey = (keyParts) =>
  Array.isArray(keyParts) ? JSON.stringify(keyParts) : String(keyParts || '');

const normalizeKeyParts = (keyParts) => (
  Array.isArray(keyParts) ? keyParts : [keyParts]
);

const isKeyPrefixMatch = (cacheKey, prefixParts) => {
  try {
    const parsedKey = JSON.parse(cacheKey);
    if (!Array.isArray(parsedKey) || parsedKey.length < prefixParts.length) {
      return false;
    }
    return prefixParts.every((part, index) => parsedKey[index] === part);
  } catch {
    const prefix = toCacheKey(prefixParts);
    return cacheKey.startsWith(prefix);
  }
};

export const buildCacheKey = (...keyParts) => toCacheKey(keyParts);

export const clearSWRCache = () => {
  cacheStore.clear();
  inFlightStore.clear();
};

export const invalidateSWRCacheByPrefix = (...prefixParts) => {
  const normalizedPrefixParts = normalizeKeyParts(prefixParts);
  [...cacheStore.keys()].forEach((key) => {
    if (isKeyPrefixMatch(key, normalizedPrefixParts)) {
      cacheStore.delete(key);
    }
  });
};

const setCacheEntry = (cacheKey, data) => {
  cacheStore.set(cacheKey, {
    data,
    updatedAt: Date.now(),
  });
};

export const setSWRCache = (keyParts, data) => {
  const cacheKey = toCacheKey(keyParts);
  setCacheEntry(cacheKey, data);
  return data;
};

const getCacheEntry = (cacheKey) => cacheStore.get(cacheKey) || null;

export const peekSWRCache = (
  keyParts,
  {
    staleTimeMs = DEFAULT_STALE_TIME_MS,
  } = {}
) => {
  const cacheKey = toCacheKey(keyParts);
  const entry = getCacheEntry(cacheKey);
  if (!entry) return null;
  const age = Date.now() - Number(entry.updatedAt || 0);
  return {
    data: entry.data,
    updatedAt: Number(entry.updatedAt || 0),
    isFresh: age <= staleTimeMs,
  };
};

const runDedupedFetch = async (cacheKey, fetcher) => {
  if (inFlightStore.has(cacheKey)) {
    return inFlightStore.get(cacheKey);
  }

  const requestPromise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      setCacheEntry(cacheKey, data);
      return data;
    })
    .finally(() => {
      inFlightStore.delete(cacheKey);
    });

  inFlightStore.set(cacheKey, requestPromise);
  return requestPromise;
};

export const getOrFetchSWR = async (
  keyParts,
  fetcher,
  {
    staleTimeMs = DEFAULT_STALE_TIME_MS,
    force = false,
    revalidateStale = true,
  } = {}
) => {
  const cacheKey = toCacheKey(keyParts);
  const now = Date.now();

  if (!force) {
    const entry = getCacheEntry(cacheKey);
    if (entry) {
      const age = now - Number(entry.updatedAt || 0);
      const isFresh = age <= staleTimeMs;

      if (isFresh) {
        return { data: entry.data, fromCache: true, isFresh: true };
      }

      if (revalidateStale) {
        runDedupedFetch(cacheKey, fetcher).catch(() => {});
      }
      return { data: entry.data, fromCache: true, isFresh: false };
    }
  }

  const data = await runDedupedFetch(cacheKey, fetcher);
  return { data, fromCache: false, isFresh: true };
};

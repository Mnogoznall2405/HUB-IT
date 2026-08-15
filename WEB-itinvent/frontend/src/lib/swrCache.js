const cacheStore = new Map();
const inFlightStore = new Map();

const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 80;
const DEFAULT_RETENTION_MS = 30 * 60 * 1000;

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

const touchCacheEntry = (cacheKey, entry) => {
  cacheStore.delete(cacheKey);
  cacheStore.set(cacheKey, entry);
  return entry;
};

export const trimSWRCache = ({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxAgeMs = DEFAULT_RETENTION_MS,
} = {}) => {
  const now = Date.now();
  const safeMaxEntries = Math.max(0, Number(maxEntries) || 0);
  const safeMaxAgeMs = Math.max(0, Number(maxAgeMs) || 0);

  [...cacheStore.entries()].forEach(([key, entry]) => {
    if ((now - Number(entry?.updatedAt || 0)) > safeMaxAgeMs) {
      cacheStore.delete(key);
    }
  });
  while (cacheStore.size > safeMaxEntries) {
    const oldestKey = cacheStore.keys().next().value;
    if (oldestKey === undefined) break;
    cacheStore.delete(oldestKey);
  }
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
  touchCacheEntry(cacheKey, {
    data,
    updatedAt: Date.now(),
  });
  trimSWRCache();
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
  trimSWRCache();
  const cacheKey = toCacheKey(keyParts);
  const entry = getCacheEntry(cacheKey);
  if (!entry) return null;
  touchCacheEntry(cacheKey, entry);
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
  trimSWRCache();
  const cacheKey = toCacheKey(keyParts);
  const now = Date.now();

  if (!force) {
    const entry = getCacheEntry(cacheKey);
    if (entry) {
      touchCacheEntry(cacheKey, entry);
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

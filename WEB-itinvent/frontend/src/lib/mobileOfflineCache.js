const DB_NAME = 'hubit-mobile-offline-v1';
const STORE_NAME = 'responses';
const DB_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;
const OFFLINE_READ_ONLY_MESSAGE = 'Без интернета доступен только просмотр ранее загруженных данных.';
export const MOBILE_OFFLINE_CACHE_META_EVENT = 'hubit:mobile-offline-cache-meta';
export const MOBILE_OFFLINE_CACHE_CLEAR_EVENT = 'hubit:mobile-offline-cache-clear';
export const MOBILE_OFFLINE_CACHE_PURGED_EVENT = 'hubit:mobile-offline-cache-purged';
export const MOBILE_NATIVE_NETWORK_STATE_EVENT = 'hubit:mobile-network-state';
const LAST_SYNC_STORAGE_PREFIX = 'hubit:mobile-offline-last-sync:';
const CACHE_MISS_STORAGE_PREFIX = 'hubit:mobile-offline-cache-miss:';

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

const normalizeObject = (value) => {
  if (Array.isArray(value)) return value.map(normalizeObject);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeObject(value[key]);
        return result;
      }, {});
  }
  return value ?? null;
};

const getSession = () => {
  if (typeof window === 'undefined' || window.__HUBIT_MOBILE_APP__ !== true) return null;
  const value = window.__HUBIT_MOBILE_OFFLINE_SESSION__;
  if (!value || typeof value !== 'object') return null;
  const userId = Number(value.user?.id || 0);
  const cacheKey = String(value.cacheKey || '').trim();
  if (!Number.isInteger(userId) || userId <= 0 || !/^[0-9a-f]{64}$/i.test(cacheKey)) {
    return null;
  }
  return { userId, cacheKey, readOnly: value.readOnly === true };
};

export const getMobileOfflineState = () => {
  const session = getSession();
  return session ? { enabled: true, readOnly: session.readOnly } : { enabled: false, readOnly: false };
};

const safeStoredNumber = (storage, key) => {
  try {
    const value = Number(storage?.getItem(key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
};

const cacheMetaKeys = (userId) => ({
  lastSync: `${LAST_SYNC_STORAGE_PREFIX}${userId}`,
  cacheMiss: `${CACHE_MISS_STORAGE_PREFIX}${userId}`,
});

export const getMobileOfflineCacheMeta = () => {
  const session = getSession();
  if (!session) return { lastSyncAt: 0, cacheMiss: false };
  const keys = cacheMetaKeys(session.userId);
  return {
    lastSyncAt: safeStoredNumber(window.localStorage, keys.lastSync),
    cacheMiss: safeStoredNumber(window.sessionStorage, keys.cacheMiss) > 0,
  };
};

const publishCacheMeta = (session, { lastSyncAt, cacheMiss }) => {
  if (!session) return;
  const keys = cacheMetaKeys(session.userId);
  try {
    if (lastSyncAt > 0) window.localStorage.setItem(keys.lastSync, String(lastSyncAt));
    if (cacheMiss) window.sessionStorage.setItem(keys.cacheMiss, String(Date.now()));
    else window.sessionStorage.removeItem(keys.cacheMiss);
  } catch {
    // Metadata is optional; encrypted response records remain the source of cached data.
  }
  try {
    window.dispatchEvent(new CustomEvent(MOBILE_OFFLINE_CACHE_META_EVENT, {
      detail: getMobileOfflineCacheMeta(),
    }));
  } catch {
    // Older WebViews can lack CustomEvent; the next layout render reads storage.
  }
};

const requestMethod = (config) => String(config?.method || 'get').trim().toLowerCase();

export const isMobileOfflineMutationBlocked = (config) => {
  const session = getSession();
  if (!session?.readOnly) return false;
  return !['get', 'head', 'options'].includes(requestMethod(config));
};

export const createMobileOfflineReadOnlyError = (config) => {
  const error = new Error(OFFLINE_READ_ONLY_MESSAGE);
  error.name = 'MobileOfflineReadOnlyError';
  error.code = 'HUBIT_OFFLINE_READ_ONLY';
  error.config = config;
  return error;
};

const requestPath = (config) => {
  const base = String(config?.baseURL || '').replace(/\/$/, '');
  const path = String(config?.url || '').replace(/^\//, '');
  return `${base}/${path}`.replace(/^https?:\/\/[^/]+/i, '').toLowerCase();
};

const isCacheablePath = (config) => {
  const path = requestPath(config);
  return ![
    '/auth/',
    '/download',
    '/export',
    '/attachment',
    '/avatar',
    '/media/',
    '/files/',
    '/file/',
    '/upload',
    '/print',
  ].some((part) => path.includes(part));
};

const buildCacheKey = (config, userId) => JSON.stringify({
  userId,
  method: requestMethod(config),
  path: requestPath(config),
  params: normalizeObject(config?.params || null),
  database: String(
    config?.headers?.['X-Database-ID']
    || config?.headers?.get?.('X-Database-ID')
    || '',
  ),
});

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const hexToBytes = (value) => Uint8Array.from(
  value.match(/.{2}/g) || [],
  (pair) => Number.parseInt(pair, 16),
);

const importKey = (hexKey) => window.crypto.subtle.importKey(
  'raw',
  hexToBytes(hexKey),
  { name: 'AES-GCM' },
  false,
  ['encrypt', 'decrypt'],
);

const encryptPayload = async (payload, hexKey) => {
  if (!encoder || !window.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const plaintext = encoder.encode(JSON.stringify(payload));
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) return null;
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importKey(hexKey),
    plaintext,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
};

const decryptPayload = async (record, hexKey) => {
  if (!decoder || !window.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const plaintext = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
    await importKey(hexKey),
    base64ToBytes(record.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext));
};

let databasePromise = null;

const openDatabase = () => {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('storedAt', 'storedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  }).catch(() => {
    databasePromise = null;
    return null;
  });
  return databasePromise;
};

const transactionRequest = async (mode, operation) => {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
};

const pruneCache = async (activeUserId) => {
  const database = await openDatabase();
  if (!database) return;
  await new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.index('storedAt').openCursor();
    let count = 0;
    const expiredBefore = Date.now();
    const keys = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        const overflow = Math.max(0, keys.length - MAX_CACHE_ENTRIES);
        keys.slice(0, overflow).forEach((key) => store.delete(key));
        return;
      }
      count += 1;
      if (
        Number(cursor.value?.expiresAt || 0) <= expiredBefore
        || Number(cursor.value?.userId || 0) !== Number(activeUserId || 0)
      ) {
        cursor.delete();
      } else {
        keys.push(cursor.primaryKey);
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(count);
    transaction.onerror = () => resolve(count);
    transaction.onabort = () => resolve(count);
  });
};

const normalizeHeaders = (headers) => {
  if (headers?.toJSON) return normalizeObject(headers.toJSON());
  return normalizeObject(headers || {});
};

const pendingCacheWrites = new Set();

const writeMobileGetResponse = async (response) => {
  const session = getSession();
  const config = response?.config;
  if (
    !session
    || requestMethod(config) !== 'get'
    || !isCacheablePath(config)
    || Number(response?.status || 0) < 200
    || Number(response?.status || 0) >= 300
    || ['blob', 'arraybuffer', 'stream'].includes(String(config?.responseType || '').toLowerCase())
  ) {
    return false;
  }
  try {
    const encrypted = await encryptPayload({
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: normalizeHeaders(response.headers),
    }, session.cacheKey);
    if (!encrypted) return false;
    const now = Date.now();
    const storedKey = await transactionRequest('readwrite', (store) => store.put({
      key: buildCacheKey(config, session.userId),
      userId: session.userId,
      storedAt: now,
      expiresAt: now + CACHE_TTL_MS,
      ...encrypted,
    }));
    if (!storedKey) return false;
    publishCacheMeta(session, { lastSyncAt: now, cacheMiss: false });
    void pruneCache(session.userId);
    return true;
  } catch {
    return false;
  }
};

export const cacheMobileGetResponse = (response) => {
  const writePromise = writeMobileGetResponse(response);
  pendingCacheWrites.add(writePromise);
  void writePromise.then(
    () => pendingCacheWrites.delete(writePromise),
    () => pendingCacheWrites.delete(writePromise),
  );
  return writePromise;
};

export const waitForPendingMobileOfflineCacheWrites = async () => {
  while (pendingCacheWrites.size > 0) {
    await Promise.allSettled([...pendingCacheWrites]);
  }
};

const canUseCachedFailure = (error) => {
  if (error?.code === 'ERR_CANCELED' || error?.config?.signal?.aborted) return false;
  const status = Number(error?.response?.status || 0);
  return !status || [502, 503, 504].includes(status);
};

export const getCachedMobileGetResponse = async (error) => {
  const session = getSession();
  const config = error?.config;
  if (
    !session?.readOnly
    || requestMethod(config) !== 'get'
    || !isCacheablePath(config)
    || !canUseCachedFailure(error)
  ) {
    return null;
  }
  try {
    const cacheKey = buildCacheKey(config, session.userId);
    const record = await transactionRequest('readonly', (store) => store.get(cacheKey));
    if (!record || Number(record.expiresAt || 0) <= Date.now()) return null;
    const cached = await decryptPayload(record, session.cacheKey);
    publishCacheMeta(session, { lastSyncAt: Number(record.storedAt || 0), cacheMiss: false });
    return {
      data: cached.data,
      status: cached.status,
      statusText: cached.statusText,
      headers: {
        ...cached.headers,
        'x-hubit-offline-cache': '1',
        'x-hubit-offline-cached-at': String(Number(record.storedAt || 0)),
      },
      config,
      request: null,
    };
  } catch {
    return null;
  }
};

export const markMobileOfflineCacheMiss = (error) => {
  const session = getSession();
  if (
    !session?.readOnly
    || requestMethod(error?.config) !== 'get'
    || !isCacheablePath(error?.config)
    || !canUseCachedFailure(error)
  ) return error;
  error.code = 'HUBIT_OFFLINE_CACHE_MISS';
  error.message = 'Эти данные ещё не были загружены на телефон.';
  publishCacheMeta(session, {
    lastSyncAt: getMobileOfflineCacheMeta().lastSyncAt,
    cacheMiss: true,
  });
  return error;
};

const moduleForPath = (path) => {
  const normalized = String(path || '').toLowerCase();
  if (normalized.includes('/chat/')) return 'chat';
  if (normalized.includes('/mail/')) return 'mail';
  if (normalized.includes('/hub/tasks') || normalized.includes('/tasks/')) return 'tasks';
  if (normalized.includes('/tickets')) return 'tickets';
  if (normalized.includes('/dashboard') || normalized.includes('/hub/')) return 'dashboard';
  if (normalized.includes('/equipment') || normalized.includes('/computers')) return 'equipment';
  return 'other';
};

const recordPath = (record) => {
  try {
    return String(JSON.parse(String(record?.key || '')).path || '');
  } catch {
    return '';
  }
};

export const getMobileOfflineCacheInventory = async () => {
  const session = getSession();
  const meta = getMobileOfflineCacheMeta();
  if (!session) return {
    ready: false,
    entryCount: 0,
    ciphertextBytes: 0,
    modules: [],
    moduleDetails: [],
    ...meta,
  };
  const records = await transactionRequest('readonly', (store) => store.getAll()).catch(() => []);
  const activeRecords = (Array.isArray(records) ? records : []).filter((record) => (
    Number(record?.userId || 0) === session.userId
    && Number(record?.expiresAt || 0) > Date.now()
  ));
  const detailMap = activeRecords.reduce((result, record) => {
    const module = moduleForPath(recordPath(record));
    const current = result.get(module) || { module, entryCount: 0, lastSyncAt: 0 };
    current.entryCount += 1;
    current.lastSyncAt = Math.max(current.lastSyncAt, Number(record?.storedAt || 0));
    result.set(module, current);
    return result;
  }, new Map());
  const moduleDetails = [...detailMap.values()].sort((left, right) => left.module.localeCompare(right.module));
  return {
    ready: activeRecords.length > 0,
    entryCount: activeRecords.length,
    ciphertextBytes: activeRecords.reduce((sum, record) => sum + String(record?.ciphertext || '').length, 0),
    modules: moduleDetails.map((item) => item.module),
    moduleDetails,
    ...meta,
  };
};

const normalizeUserIds = (value) => {
  if (!Array.isArray(value) || value.length > 8) return [];
  return [...new Set(value.filter((item) => (
    typeof item === 'number' && Number.isInteger(item) && item > 0
  )))];
};

export const clearMobileOfflineCacheForUserIds = async (userIds) => {
  if (typeof window === 'undefined' || window.__HUBIT_MOBILE_APP__ !== true) return 0;
  const normalizedUserIds = normalizeUserIds(userIds);
  if (!normalizedUserIds.length) return 0;
  const userIdSet = new Set(normalizedUserIds);
  const database = await openDatabase();
  const removed = database
    ? await new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      let count = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (userIdSet.has(Number(cursor.value?.userId || 0))) {
          cursor.delete();
          count += 1;
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(count);
      transaction.onerror = () => resolve(count);
      transaction.onabort = () => resolve(count);
    })
    : 0;
  for (const userId of normalizedUserIds) {
    const keys = cacheMetaKeys(userId);
    try {
      window.localStorage.removeItem(keys.lastSync);
      window.sessionStorage.removeItem(keys.cacheMiss);
    } catch {
      // IndexedDB data is already removed; metadata cleanup is best effort.
    }
  }
  return removed;
};

export const clearMobileOfflineCache = async () => {
  const session = getSession();
  if (!session) return 0;
  const removed = await clearMobileOfflineCacheForUserIds([session.userId]);
  publishCacheMeta(session, { lastSyncAt: 0, cacheMiss: false });
  return removed;
};

if (typeof window !== 'undefined' && !window.__HUBIT_MOBILE_OFFLINE_CLEAR_BOUND__) {
  window.__HUBIT_MOBILE_OFFLINE_CLEAR_BOUND__ = true;
  window.addEventListener(MOBILE_OFFLINE_CACHE_CLEAR_EVENT, () => {
    void clearMobileOfflineCache();
  });
}

if (typeof window !== 'undefined' && window.__HUBIT_MOBILE_APP__ === true) {
  const pendingPurgeUserIds = normalizeUserIds(window.__HUBIT_MOBILE_OFFLINE_PURGE_USER_IDS__);
  if (pendingPurgeUserIds.length) {
    void clearMobileOfflineCacheForUserIds(pendingPurgeUserIds).then(() => {
      window.__HUBIT_MOBILE_OFFLINE_PURGE_USER_IDS__ = [];
      window.dispatchEvent(new CustomEvent(MOBILE_OFFLINE_CACHE_PURGED_EVENT, {
        detail: { userIds: pendingPurgeUserIds },
      }));
    });
  }
}

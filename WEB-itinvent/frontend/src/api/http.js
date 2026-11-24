/**
 * Axios HTTP core: instance, base URL, interceptors, shared cache helpers.
 * Domain API modules import this file instead of the aggregated client barrel,
 * which keeps client.js (and its ~60 domain imports) out of per-feature chunks.
 */

import axios from 'axios';
import { buildCacheKey, getOrFetchSWR } from '../lib/swrCache';
import {
  cacheMobileGetResponse,
  createMobileOfflineReadOnlyError,
  getCachedMobileGetResponse,
  isMobileOfflineMutationBlocked,
  markMobileOfflineCacheMiss,
} from '../lib/mobileOfflineCache';

const rawBase = String(import.meta.env.BASE_URL || '/');
const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
const basePrefix = normalizedBase.endsWith('/') && normalizedBase.length > 1
  ? normalizedBase.slice(0, -1)
  : normalizedBase;

// Use app-relative /api by default so IIS virtual directories work too.
const derivedApiBase = basePrefix === '/' ? '/api' : `${basePrefix}/api`;
const API_BASE_URL = import.meta.env.VITE_API_URL || derivedApiBase;
export const API_V1_BASE = `${API_BASE_URL}/v1`;
const SYSTEM_GET_STALE_TIME_MS = 30_000;

const normalizeDbId = (value) => String(value ?? '').trim();

const normalizeCacheValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCacheValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeCacheValue(value[key]);
        return acc;
      }, {});
  }
  return value ?? null;
};

const getSelectedDatabaseCachePart = () => {
  try {
    return normalizeDbId(window.localStorage.getItem('selected_database'));
  } catch {
    return '';
  }
};

let refreshInFlight = null;
// Fan-out guard: N параллельных 401 после финального отказа refresh иначе
// дадут N событий `auth-required` и N telemetry — шлём один раз на «эпоху»
// отклонённой сессии; успешный login/refresh открывает новую.
let authRequiredNotified = false;
let refreshFailureReported = false;

const resetAuthRejectionEpoch = () => {
  authRequiredNotified = false;
  refreshFailureReported = false;
};

// Cross-tab refresh coordination. The backend rotates the refresh cookie and
// tolerates exactly one replay of the old cookie (reuse limit). All tabs share
// the cookie jar, so a second tab POSTing /auth/refresh with the same cookie
// counts as a replay and revokes the whole token family. Coordinate through
// navigator.locks plus a localStorage epoch marker: one tab rotates, siblings
// observe the fresh epoch and skip their own POST.
const REFRESH_EPOCH_STORAGE_KEY = 'hubit.auth.refresh_epoch';
const REFRESH_CLAIM_STORAGE_KEY = 'hubit.auth.refresh_claim';
const REFRESH_RECENT_WINDOW_MS = 10_000;
const REFRESH_NETWORK_RETRY_DELAY_MS = 500;
const REFRESH_CLAIM_POLL_MS = 150;
const REFRESH_CLAIM_WAIT_MS = 12_000;
const REFRESH_LOCK_NAME = 'hubit.auth.refresh';

const readRefreshMarker = (key) => {
  try {
    return Number(window.localStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
};

const writeRefreshMarker = (key, timestamp) => {
  try {
    window.localStorage.setItem(key, String(timestamp));
  } catch {
    // Storage unavailable (private mode) — coordination degrades to per-tab only.
  }
};

const markRefreshEpoch = () => writeRefreshMarker(REFRESH_EPOCH_STORAGE_KEY, Date.now());
const siblingRefreshedRecently = () => (
  Date.now() - readRefreshMarker(REFRESH_EPOCH_STORAGE_KEY) < REFRESH_RECENT_WINDOW_MS
);
const markRefreshClaim = () => writeRefreshMarker(REFRESH_CLAIM_STORAGE_KEY, Date.now());
const clearRefreshClaim = () => {
  try {
    window.localStorage.removeItem(REFRESH_CLAIM_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
};
const siblingClaimedRecently = () => (
  Date.now() - readRefreshMarker(REFRESH_CLAIM_STORAGE_KEY) < REFRESH_RECENT_WINDOW_MS
);

// Callers only await the refresh and retry their own request (or ignore the
// payload entirely) — a defined-shape sentinel keeps `response.data` readers
// safe when a sibling tab performed the rotation.
const skippedRefreshResponse = () => ({ data: { skipped: true }, skippedRefresh: true });

const postRefreshRequest = () => (
  apiClient.post('/auth/refresh', null, { suppressAuthRequired: true })
);

const REFRESH_RETRYABLE_CODES = new Set(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT']);
const isRetryableTransportError = (requestError) => (
  !requestError?.response && REFRESH_RETRYABLE_CODES.has(requestError?.code)
);

// A lost rotation response (network cut between server commit and client read)
// leaves this tab holding an already-rotated cookie. The reuse limit tolerates
// exactly one replay within the grace window, so retry a transport-failed
// refresh exactly once. A definitive response (4xx/5xx) is never retried —
// posting again would burn the grace replay and revoke the family.
const performRefreshRequest = async () => {
  try {
    return await postRefreshRequest();
  } catch (firstError) {
    if (!isRetryableTransportError(firstError)) throw firstError;
    if (siblingRefreshedRecently()) return skippedRefreshResponse();
    await new Promise((resolve) => { setTimeout(resolve, REFRESH_NETWORK_RETRY_DELAY_MS); });
    try {
      return await postRefreshRequest();
    } catch (secondError) {
      // Both attempts were lost in transport — the server may have rotated the
      // cookie anyway, leaving the jar with a replay-prone stale cookie. Mark
      // the epoch (shifted so it outlives the backend grace window) so no tab
      // burns the last allowed reuse and revokes the whole family. The next
      // attempt after the window gets a definitive answer instead.
      if (!secondError?.response) {
        writeRefreshMarker(REFRESH_EPOCH_STORAGE_KEY, Date.now() + REFRESH_RECENT_WINDOW_MS);
      }
      throw secondError;
    }
  }
};

const refreshAuthSessionLocked = async () => {
  // NOTE: a tab that waited on the lock longer than the epoch window performs
  // a redundant — but legitimate — rotation of the *current* cookie, never a
  // replay. The epoch only dedupes the common fast case.
  if (siblingRefreshedRecently()) return skippedRefreshResponse();
  const response = await performRefreshRequest();
  markRefreshEpoch();
  return response;
};

const waitForSiblingClaim = async () => {
  const deadline = Date.now() + REFRESH_CLAIM_WAIT_MS;
  while (siblingClaimedRecently() && Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, REFRESH_CLAIM_POLL_MS); });
  }
};

// Fallback when Web Locks is unavailable (e.g. plain-HTTP intranet deploys —
// the API is secure-context only). The localStorage claim narrows the
// check-then-POST race from a full request RTT to one synchronous write.
// A tab seeing a fresh claim must WAIT for the holder — skipping immediately
// would retry its request with the still-old cookie and log the session out.
const refreshAuthSessionUnlocked = async () => {
  if (siblingRefreshedRecently()) return skippedRefreshResponse();
  if (siblingClaimedRecently()) {
    await waitForSiblingClaim();
    if (siblingRefreshedRecently()) return skippedRefreshResponse();
  }
  markRefreshClaim();
  try {
    const response = await performRefreshRequest();
    markRefreshEpoch();
    return response;
  } finally {
    clearRefreshClaim();
  }
};

const refreshAuthSessionAcrossTabs = () => {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks || typeof locks.request !== 'function') {
    return refreshAuthSessionUnlocked();
  }
  return locks.request(REFRESH_LOCK_NAME, () => refreshAuthSessionLocked());
};

function refreshAuthSession() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAuthSessionAcrossTabs()
      .then((response) => {
        resetAuthRejectionEpoch();
        return response;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
let chatRequestDebugSeq = 0;

const CHAT_REQUEST_DEBUG_STORAGE_KEY = 'chat:request-debug';

const shouldDebugChatRequests = () => {
  try {
    if (typeof window === 'undefined') return false;
    const pathname = String(window.location?.pathname || '').trim();
    if (!pathname.startsWith('/chat')) return false;
    // Opt-in only: localStorage['chat:request-debug'] = '1'. Request URLs may carry search strings.
    return window.localStorage.getItem(CHAT_REQUEST_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const buildDebugRequestUrl = (config) => {
  const baseUrl = String(config?.baseURL || API_V1_BASE || '').trim();
  const rawUrl = String(config?.url || '').trim();
  let normalizedUrl = rawUrl;
  if (baseUrl && rawUrl.startsWith('/')) {
    normalizedUrl = `${baseUrl}${rawUrl}`;
  }
  const params = config?.params;
  if (!params || typeof params !== 'object') return normalizedUrl;
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${normalizedUrl}?${query}` : normalizedUrl;
};

const pushChatRequestDebugEntry = (entry) => {
  try {
    if (typeof window === 'undefined') return;
    const nextEntry = {
      seq: ++chatRequestDebugSeq,
      ...entry,
    };
    const current = Array.isArray(window.__chatRequestLog) ? window.__chatRequestLog : [];
    window.__chatRequestLog = [...current.slice(-119), nextEntry];
    const prefix = `[chat-request #${nextEntry.seq}]`;
    if (nextEntry.phase === 'request') {
      console.log(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url}`, nextEntry);
      return;
    }
    if (nextEntry.phase === 'response') {
      console.log(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url} -> ${nextEntry.status} (${nextEntry.durationMs}ms)`, nextEntry);
      return;
    }
    console.warn(prefix, `${String(nextEntry.method || 'GET').toUpperCase()} ${nextEntry.url} -> ${nextEntry.status || 'ERR'} (${nextEntry.durationMs}ms)`, nextEntry);
  } catch {
    // Ignore request debug logging failures.
  }
};

const createClientRequestId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const isScanApiRequestUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const path = raw.replace(/^https?:\/\/[^/]+/i, '');
  return (
    path === '/scan'
    || path.startsWith('/scan/')
    || path.startsWith('/scan?')
    || path === '/api/v1/scan'
    || path.startsWith('/api/v1/scan/')
    || path.startsWith('/api/v1/scan?')
  );
};

// VoiceVideo is also served by a separate service (like scan): a stale-401 from
// it must not tear down the main backend session after a successful refresh.
const isVoiceApiRequestUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const path = raw.replace(/^https?:\/\/[^/]+/i, '');
  return (
    path === '/voice'
    || path.startsWith('/voice/')
    || path.startsWith('/voice?')
    || path === '/api/v1/voice'
    || path.startsWith('/api/v1/voice/')
    || path.startsWith('/api/v1/voice?')
  );
};

const isMyFilesPublicRequestUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const path = raw.replace(/^https?:\/\/[^/]+/i, '');
  return (
    path.includes('/my-files/public/')
    || path.includes('/my-files/public?')
  );
};

const isDefinitiveAuthRejection = (requestError) => {
  const status = Number(requestError?.response?.status || 0);
  return status === 401 || status === 403;
};

/**
 * Create axios instance with default configuration
 */
const apiClient = axios.create({
  baseURL: API_V1_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
  timeout: 30000,
});

function reportAuthSessionTelemetry({ event, detail, path } = {}) {
  const name = String(event || '').trim();
  if (!name) return;
  try {
    void apiClient.post(
      '/auth/session-telemetry',
      {
        event: name,
        detail: detail ? String(detail).slice(0, 200) : undefined,
        path: path ? String(path).slice(0, 200) : undefined,
      },
      {
        suppressAuthRequired: true,
        timeout: 3000,
      },
    ).catch(() => {
      // Best-effort beacon: a failed send must not surface as an unhandled rejection.
    });
  } catch {
    // Best-effort beacon; never block logout path.
  }
}

/**
 * Request interceptor - add selected database to all requests
 */
apiClient.interceptors.request.use(
  (config) => {
    if (isMobileOfflineMutationBlocked(config)) {
      throw createMobileOfflineReadOnlyError(config);
    }
    // For multipart uploads let the browser set boundary automatically.
    if (typeof FormData !== 'undefined' && config?.data instanceof FormData) {
      if (config.headers?.delete) {
        config.headers.delete('Content-Type');
        config.headers.delete('content-type');
      } else if (config.headers?.set) {
        config.headers.set('Content-Type', undefined);
        config.headers.set('content-type', undefined);
      } else if (config.headers) {
        delete config.headers['Content-Type'];
        delete config.headers['content-type'];
      }
    }

    const selectedDatabase = localStorage.getItem('selected_database');
    if (selectedDatabase && config.headers['X-Database-ID'] == null) {
      config.headers['X-Database-ID'] = selectedDatabase;
    }
    if (!config.headers['X-Client-Request-ID']) {
      config.headers['X-Client-Request-ID'] = createClientRequestId();
    }
    if (shouldDebugChatRequests()) {
      config.metadata = {
        ...(config.metadata || {}),
        startedAt: Date.now(),
        debugUrl: buildDebugRequestUrl(config),
      };
      pushChatRequestDebugEntry({
        phase: 'request',
        method: String(config?.method || 'get').toUpperCase(),
        url: config.metadata.debugUrl,
      });
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Response interceptor - handle 401 errors
 */
apiClient.interceptors.response.use(
  (response) => {
    const metadata = response?.config?.metadata || {};
    const responseUrl = String(response?.config?.url || '');
    // Exact-path match: '/auth/login-mode' is public (no cookies issued) and a
    // substring check would let it mark the epoch, wrongly skipping queued
    // refreshes for live sessions.
    const responsePath = responseUrl.split('?')[0];
    if (
      responsePath === '/auth/login'
      || responsePath.endsWith('/auth/login')
      || responsePath.includes('/auth/verify-2fa')
      || responsePath.includes('/auth/passkey-login/verify')
    ) {
      resetAuthRejectionEpoch();
      markRefreshEpoch();
    }
    if (shouldDebugChatRequests()) {
      pushChatRequestDebugEntry({
        phase: 'response',
        method: String(response?.config?.method || 'get').toUpperCase(),
        url: String(metadata.debugUrl || buildDebugRequestUrl(response?.config || {})),
        status: Number(response?.status || 0),
        durationMs: Math.max(0, Date.now() - Number(metadata.startedAt || Date.now())),
      });
    }
    void cacheMobileGetResponse(response);
    return response;
  },
  async (error) => {
    const metadata = error?.config?.metadata || {};
    if (shouldDebugChatRequests()) {
      pushChatRequestDebugEntry({
        phase: 'error',
        method: String(error?.config?.method || 'get').toUpperCase(),
        url: String(metadata.debugUrl || buildDebugRequestUrl(error?.config || {})),
        status: Number(error?.response?.status || 0) || 'ERR',
        durationMs: Math.max(0, Date.now() - Number(metadata.startedAt || Date.now())),
        message: String(error?.message || 'request failed'),
      });
    }
    const cachedResponse = await getCachedMobileGetResponse(error);
    if (cachedResponse) return cachedResponse;

    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '');
      if (isMyFilesPublicRequestUrl(requestUrl)) {
        return Promise.reject(error);
      }
      const suppressAuthRequired = Boolean(error.config?.suppressAuthRequired);
      const isLoginRequest = requestUrl.includes('/auth/login');
      const isRefreshRequest = requestUrl.includes('/auth/refresh');
      const isSessionTelemetryRequest = requestUrl.includes('/auth/session-telemetry');
      const isInteractiveAuthFlowRequest =
        requestUrl.includes('/auth/verify-2fa') ||
        requestUrl.includes('/auth/enable-2fa') ||
        requestUrl.includes('/auth/trusted-devices/auth/') ||
        requestUrl.includes('/auth/passkey-login/');
      const canRetryWithRefresh =
        !error.config?._retry
        && !isLoginRequest
        && !isRefreshRequest
        && !isSessionTelemetryRequest
        && !isInteractiveAuthFlowRequest;

      if (canRetryWithRefresh) {
        try {
          await refreshAuthSession();
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('auth-token-refreshed'));
          }
          error.config._retry = true;
          return apiClient.request(error.config);
        } catch (refreshError) {
          const refreshDetail = String(
            refreshError?.response?.data?.detail
            || refreshError?.message
            || 'refresh_failed',
          );
          if (!refreshFailureReported) {
            refreshFailureReported = true;
            reportAuthSessionTelemetry({
              event: 'client_refresh_failed',
              detail: refreshDetail,
              path: requestUrl,
            });
          }
          if (!isDefinitiveAuthRejection(refreshError)) {
            return Promise.reject(refreshError);
          }
          // The refresh endpoint definitively rejected the session. Fall
          // through to the existing auth-required handling below.
        }
      }

      // Scan Center and VoiceVideo are served by separate services. If the main
      // backend refresh succeeds but the retried request still gets 401, keep the
      // web session intact and let the page show its own loading error.
      if (error.config?._retry && (isScanApiRequestUrl(requestUrl) || isVoiceApiRequestUrl(requestUrl))) {
        return Promise.reject(error);
      }

      // Session expired or invalid - clear cached user and notify app state.
      localStorage.removeItem('user');
      if (!suppressAuthRequired && !isLoginRequest && !isSessionTelemetryRequest && !authRequiredNotified) {
        authRequiredNotified = true;
        reportAuthSessionTelemetry({
          event: 'client_auth_required',
          detail: isRefreshRequest ? 'refresh_endpoint' : 'api_401',
          path: requestUrl,
        });
        window.dispatchEvent(new CustomEvent('auth-required', { detail: { requestUrl } }));
      }
    }
    return Promise.reject(markMobileOfflineCacheMiss(error));
  }
);

export default apiClient;
export { apiClient };

export const getCachedGet = async (
  cacheScope,
  url,
  {
    params = undefined,
    staleTimeMs = SYSTEM_GET_STALE_TIME_MS,
    force = false,
    suppressAuthRequired = false,
  } = {},
) => {
  const cacheKey = buildCacheKey(
    'http-get',
    cacheScope,
    url,
    getSelectedDatabaseCachePart(),
    normalizeCacheValue(params || {}),
  );
  const { data } = await getOrFetchSWR(
    cacheKey,
    async () => (
      await apiClient.get(url, {
        params,
        suppressAuthRequired,
      })
    ).data,
    {
      staleTimeMs,
      force,
    },
  );
  return data;
};

export { refreshAuthSession };

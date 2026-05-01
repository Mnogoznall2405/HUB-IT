/**
 * Axios API client for backend communication.
 */

import axios from 'axios';
import { buildCacheKey, getOrFetchSWR } from '../lib/swrCache';

const rawBase = String(import.meta.env.BASE_URL || '/');
const normalizedBase = rawBase === './' || rawBase === '.' ? '/' : rawBase;
const basePrefix = normalizedBase.endsWith('/') && normalizedBase.length > 1
  ? normalizedBase.slice(0, -1)
  : normalizedBase;

// Use app-relative /api by default so IIS virtual directories work too.
const derivedApiBase = basePrefix === '/' ? '/api' : `${basePrefix}/api`;
const API_BASE_URL = import.meta.env.VITE_API_URL || derivedApiBase;
export const API_V1_BASE = `${API_BASE_URL}/v1`;
export const UPLOADED_ACT_PARSE_TIMEOUT_MS = 180_000;
const SCAN_HOSTS_404_KEY = 'itinvent_scan_hosts_404';
const SCAN_HOSTS_404_TTL_MS = 6 * 60 * 60 * 1000;
const SYSTEM_GET_STALE_TIME_MS = 30_000;
const DATABASE_META_STALE_TIME_MS = 5 * 60 * 1000;
const PUSH_CONFIG_STALE_TIME_MS = 60_000;
const MAIL_UNREAD_COUNT_STALE_TIME_MS = 60_000;

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

const readScanHosts404Flag = () => {
  try {
    const raw = String(window.localStorage.getItem(SCAN_HOSTS_404_KEY) || '').trim();
    const ts = Number(raw);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) < SCAN_HOSTS_404_TTL_MS;
  } catch {
    return false;
  }
};

let scanHostsEndpointUnavailable = readScanHosts404Flag();
let refreshInFlight = null;
let chatRequestDebugSeq = 0;

const CHAT_REQUEST_DEBUG_STORAGE_KEY = 'chat:request-debug';

const shouldDebugChatRequests = () => {
  try {
    if (typeof window === 'undefined') return false;
    const pathname = String(window.location?.pathname || '').trim();
    if (!pathname.startsWith('/chat')) return false;
    return window.localStorage.getItem(CHAT_REQUEST_DEBUG_STORAGE_KEY) !== '0';
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

const markScanHostsUnavailable = (value) => {
  scanHostsEndpointUnavailable = Boolean(value);
  try {
    if (scanHostsEndpointUnavailable) {
      window.localStorage.setItem(SCAN_HOSTS_404_KEY, String(Date.now()));
    } else {
      window.localStorage.removeItem(SCAN_HOSTS_404_KEY);
    }
  } catch {
    // no-op
  }
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

/**
 * Request interceptor - add selected database to all requests
 */
apiClient.interceptors.request.use(
  (config) => {
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
    if (selectedDatabase) {
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
    if (shouldDebugChatRequests()) {
      pushChatRequestDebugEntry({
        phase: 'response',
        method: String(response?.config?.method || 'get').toUpperCase(),
        url: String(metadata.debugUrl || buildDebugRequestUrl(response?.config || {})),
        status: Number(response?.status || 0),
        durationMs: Math.max(0, Date.now() - Number(metadata.startedAt || Date.now())),
      });
    }
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
    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '');
      const suppressAuthRequired = Boolean(error.config?.suppressAuthRequired);
      const isLoginRequest = requestUrl.includes('/auth/login');
      const isRefreshRequest = requestUrl.includes('/auth/refresh');
      const isInteractiveAuthFlowRequest =
        requestUrl.includes('/auth/verify-2fa') ||
        requestUrl.includes('/auth/enable-2fa') ||
        requestUrl.includes('/auth/trusted-devices/auth/') ||
        requestUrl.includes('/auth/passkey-login/');
      const canRetryWithRefresh = !error.config?._retry && !isLoginRequest && !isRefreshRequest && !isInteractiveAuthFlowRequest;

      if (canRetryWithRefresh) {
        try {
          if (!refreshInFlight) {
            refreshInFlight = apiClient.post('/auth/refresh', null, { suppressAuthRequired: true });
          }
          await refreshInFlight;
          error.config._retry = true;
          return apiClient.request(error.config);
        } catch {
          // Fall through to auth-required handling below.
        } finally {
          refreshInFlight = null;
        }
      }

      // Session expired or invalid - clear cached user and notify app state.
      localStorage.removeItem('user');
      if (!suppressAuthRequired && !isLoginRequest) {
        window.dispatchEvent(new CustomEvent('auth-required', { detail: { requestUrl } }));
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
export { apiClient };

/**
 * Auth API methods
 */
export const authAPI = {
  getLoginMode: async () => {
    const response = await apiClient.get('/auth/login-mode', { suppressAuthRequired: true });
    return response.data;
  },

  login: async (username, password) => {
    const response = await apiClient.post('/auth/login', { username, password }, { suppressAuthRequired: true });
    return response.data;
  },

  startTwoFactorSetup: async (loginChallengeId) => {
    const response = await apiClient.post('/auth/enable-2fa', {
      login_challenge_id: loginChallengeId,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTwoFactorSetup: async (loginChallengeId, totpCode) => {
    const response = await apiClient.post('/auth/verify-2fa', {
      login_challenge_id: loginChallengeId,
      totp_code: totpCode,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTwoFactorLogin: async (loginChallengeId, payload = {}) => {
    const response = await apiClient.post('/auth/verify-2fa-login', {
      login_challenge_id: loginChallengeId,
      totp_code: payload?.totp_code || undefined,
      backup_code: payload?.backup_code || undefined,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  refresh: async () => {
    const response = await apiClient.post('/auth/refresh', null, { suppressAuthRequired: true });
    return response.data;
  },

  regenerateBackupCodes: async () => {
    const response = await apiClient.post('/auth/backup-codes/regenerate');
    return response.data;
  },

  getTrustedDevices: async () => {
    const response = await apiClient.get('/auth/trusted-devices');
    return response.data;
  },

  revokeTrustedDevice: async (deviceId) => {
    const response = await apiClient.delete(`/auth/trusted-devices/${encodeURIComponent(deviceId)}`);
    return response.data;
  },

  getTrustedDeviceRegistrationOptions: async (label, options = {}) => {
    const response = await apiClient.post('/auth/trusted-devices/register/options', {
      label: label || undefined,
      platform_only: Boolean(options?.platformOnly),
    });
    return response.data;
  },

  verifyTrustedDeviceRegistration: async (challengeId, credential, label) => {
    const response = await apiClient.post('/auth/trusted-devices/register/verify', {
      challenge_id: challengeId,
      credential,
      label: label || undefined,
    });
    return response.data;
  },

  getTrustedDeviceAuthOptions: async (loginChallengeId) => {
    const response = await apiClient.post('/auth/trusted-devices/auth/options', {
      login_challenge_id: loginChallengeId,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  verifyTrustedDeviceAuth: async (loginChallengeId, challengeId, credential) => {
    const response = await apiClient.post('/auth/trusted-devices/auth/verify', {
      login_challenge_id: loginChallengeId,
      challenge_id: challengeId,
      credential,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  getPasskeyLoginOptions: async () => {
    const response = await apiClient.post('/auth/passkey-login/options', null, { suppressAuthRequired: true });
    return response.data;
  },

  verifyPasskeyLogin: async (challengeId, credential) => {
    const response = await apiClient.post('/auth/passkey-login/verify', {
      challenge_id: challengeId,
      credential,
    }, { suppressAuthRequired: true });
    return response.data;
  },

  adminResetTwoFactor: async (userId) => {
    const response = await apiClient.post(`/auth/users/${encodeURIComponent(userId)}/reset-2fa`);
    return response.data;
  },

  resetOwnTwoFactor: async () => {
    const response = await apiClient.post('/auth/reset-2fa-self');
    return response.data;
  },

  logout: async () => {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },

  getCurrentUser: async (options = {}) => {
    const response = await apiClient.get('/auth/me', {
      suppressAuthRequired: Boolean(options?.suppressAuthRequired),
    });
    return response.data;
  },

  changePassword: async (oldPassword, newPassword) => {
    const response = await apiClient.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
    return response.data;
  },

  getSessions: async () => {
    const response = await apiClient.get('/auth/sessions');
    return response.data;
  },

  terminateSession: async (sessionId) => {
    const response = await apiClient.delete(`/auth/sessions/${encodeURIComponent(sessionId)}`);
    return response.data;
  },

  cleanupSessions: async () => {
    const response = await apiClient.post('/auth/sessions/cleanup');
    return response.data;
  },

  purgeInactiveSessions: async () => {
    const response = await apiClient.post('/auth/sessions/purge-inactive');
    return response.data;
  },

  getUsers: async () => {
    const response = await apiClient.get('/auth/users');
    return response.data;
  },

  createUser: async (payload) => {
    const response = await apiClient.post('/auth/users', payload);
    return response.data;
  },

  updateUser: async (userId, payload) => {
    const response = await apiClient.patch(`/auth/users/${userId}`, payload);
    return response.data;
  },

  getTaskDelegates: async (userId) => {
    const response = await apiClient.get(`/auth/users/${userId}/task-delegates`);
    return response.data;
  },

  updateTaskDelegates: async (userId, items = []) => {
    const response = await apiClient.put(`/auth/users/${userId}/task-delegates`, {
      items: Array.isArray(items) ? items : [],
    });
    return response.data;
  },

  deleteUser: async (userId) => {
    const response = await apiClient.delete(`/auth/users/${userId}`);
    return response.data;
  },

  syncAD: async () => {
    const response = await apiClient.post('/auth/sync-ad');
    return response.data;
  },
};

const getCachedGet = async (
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

const CHAT_UPLOAD_SESSION_FALLBACK_STATUSES = new Set([404, 405, 500, 501, 502, 503, 504]);
const CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS = [1000, 3000, 7000];
const CHAT_UPLOAD_SESSION_MAX_CONCURRENCY = 2;
const CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES = 2 * 1024 * 1024;

const sleepWithSignal = async (ms, signal) => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve, reject) => {
    let timeoutId = null;
    const scope = typeof globalThis !== 'undefined' ? globalThis : window;
    const cleanup = () => {
      if (timeoutId !== null) scope.clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(new axios.CanceledError('Chat upload aborted'));
    };
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    timeoutId = scope.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener?.('abort', handleAbort, { once: true });
  });
};

const isAbortError = (error) => (
  String(error?.code || '').trim() === 'ERR_CANCELED'
  || String(error?.name || '').trim() === 'AbortError'
  || String(error?.name || '').trim() === 'CanceledError'
);

const isChatUploadTransferFile = (value) => Boolean(value && typeof value.slice === 'function');

const normalizeChatUploadEntry = (value) => {
  if (!value) return null;

  if (isChatUploadTransferFile(value)) {
    const fileName = String(value?.name || '').trim() || 'file.bin';
    const mimeType = String(value?.type || '').trim() || undefined;
    const originalSize = Math.max(0, Number(value?.size || 0));
    return {
      file: value,
      transferFile: value,
      fileName,
      mimeType,
      size: originalSize,
      originalSize,
      transferEncoding: 'identity',
    };
  }

  const file = isChatUploadTransferFile(value?.file) ? value.file : null;
  const transferFile = isChatUploadTransferFile(value?.transferFile) ? value.transferFile : file;
  if (!transferFile) {
    return null;
  }

  const normalizedFile = file || transferFile;
  const fileName = String(normalizedFile?.name || transferFile?.name || value?.file_name || '').trim() || 'file.bin';
  const mimeType = String(normalizedFile?.type || transferFile?.type || value?.mime_type || '').trim() || undefined;
  const originalSize = Math.max(0, Number(value?.preparedSize ?? normalizedFile?.size ?? transferFile?.size ?? 0));
  const transferSize = Math.max(0, Number(value?.transferSize ?? transferFile?.size ?? originalSize));

  return {
    file: normalizedFile,
    transferFile,
    fileName,
    mimeType,
    size: transferSize,
    originalSize,
    transferEncoding: String(value?.transferEncoding || 'identity').trim() === 'gzip' ? 'gzip' : 'identity',
  };
};

const canUseChatUploadSessions = (files) => (
  typeof Blob !== 'undefined'
  && typeof FormData !== 'undefined'
  && Array.isArray(files)
  && files.length > 0
  && files.every((file) => isChatUploadTransferFile(file?.transferFile || file))
);

const shouldFallbackChatUploadSession = (error) => {
  if (!error) return true;
  const status = Number(error?.response?.status || 0);
  if (!status) return true;
  if (status >= 500) return true;
  return CHAT_UPLOAD_SESSION_FALLBACK_STATUSES.has(status);
};

const emitChatUploadProgress = (callback, loaded, total) => {
  if (typeof callback !== 'function') return;
  callback({
    loaded: Math.max(0, Number(loaded || 0)),
    total: Math.max(0, Number(total || 0)),
  });
};

const getChatChunkByteLength = (chunkIndex, size, chunkSizeBytes) => {
  const safeChunkIndex = Math.max(0, Number(chunkIndex || 0));
  const safeSize = Math.max(0, Number(size || 0));
  const safeChunkSize = Math.max(1, Number(chunkSizeBytes || CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES));
  const start = safeChunkIndex * safeChunkSize;
  if (start >= safeSize) return 0;
  return Math.min(safeChunkSize, safeSize - start);
};

const uploadChatFilesMultipart = async (conversationId, files = [], options = {}) => {
  const normalizedFiles = (Array.isArray(files) ? files : [])
    .map((file) => normalizeChatUploadEntry(file))
    .filter(Boolean);
  const formData = new FormData();
  normalizedFiles.forEach((file) => {
    if (file?.transferFile) formData.append('files', file.transferFile);
  });
  if (normalizedFiles.length > 0) {
    formData.append('files_meta_json', JSON.stringify(
      normalizedFiles.map((file) => ({
        original_size: Number(file?.originalSize || 0),
        transfer_encoding: String(file?.transferEncoding || 'identity').trim() || 'identity',
      })),
    ));
  }
  const normalizedBody = String(options?.body || '').trim();
  if (normalizedBody) {
    formData.append('body', normalizedBody);
  }
  if (options?.reply_to_message_id) {
    formData.append('reply_to_message_id', options.reply_to_message_id);
  }
  const response = await apiClient.post(
    `/chat/conversations/${encodeURIComponent(conversationId)}/messages/files`,
    formData,
    {
      onUploadProgress: options?.onUploadProgress,
      signal: options?.signal,
    },
  );
  return response.data;
};

export const chatAPI = {
  getHealth: async () => {
    const response = await apiClient.get('/chat/health');
    return response.data;
  },

  getUnreadSummary: async () => {
    const response = await apiClient.get('/chat/unread-summary');
    return response.data;
  },

  getPushConfig: async () => {
    const response = await apiClient.get('/chat/push-config');
    return response.data;
  },

  upsertPushSubscription: async (payload) => {
    const response = await apiClient.put('/chat/push-subscription', payload);
    return response.data;
  },

  deletePushSubscription: async (endpoint) => {
    const response = await apiClient.delete('/chat/push-subscription', {
      data: { endpoint },
    });
    return response.data;
  },

  getUsers: async (params = {}) => {
    const response = await apiClient.get('/chat/users', { params });
    return response.data;
  },

  listAiBots: async () => {
    const response = await apiClient.get('/chat/ai/bots');
    return response.data;
  },

  openAiBotConversation: async (botId) => {
    const response = await apiClient.post(`/chat/ai/bots/${encodeURIComponent(botId)}/open`);
    return response.data;
  },

  getConversations: async (params = {}) => {
    const response = await apiClient.get('/chat/conversations', { params });
    return response.data;
  },

  getConversation: async (conversationId, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  getConversationAiStatus: async (conversationId) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/ai-status`);
    return response.data;
  },

  confirmAiAction: async (actionId, payload = undefined) => {
    const response = await apiClient.post(`/chat/ai/actions/${encodeURIComponent(actionId)}/confirm`, payload || {});
    return response.data;
  },

  cancelAiAction: async (actionId) => {
    const response = await apiClient.post(`/chat/ai/actions/${encodeURIComponent(actionId)}/cancel`);
    return response.data;
  },

  updateConversationSettings: async (conversationId, payload) => {
    const response = await apiClient.patch(`/chat/conversations/${encodeURIComponent(conversationId)}/settings`, payload);
    return response.data;
  },

  createDirectConversation: async (peerUserId) => {
    const response = await apiClient.post('/chat/conversations/direct', {
      peer_user_id: peerUserId,
    });
    return response.data;
  },

  createGroupConversation: async (payload) => {
    const response = await apiClient.post('/chat/conversations/group', payload);
    return response.data;
  },

  addGroupMembers: async (conversationId, memberUserIds) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/members`, {
      member_user_ids: Array.isArray(memberUserIds) ? memberUserIds : [],
    });
    return response.data;
  },

  removeGroupMember: async (conversationId, userId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`
    );
    return response.data;
  },

  updateGroupMemberRole: async (conversationId, userId, memberRole) => {
    const response = await apiClient.patch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}/role`,
      { member_role: memberRole }
    );
    return response.data;
  },

  transferGroupOwnership: async (conversationId, ownerUserId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/ownership`, {
      owner_user_id: ownerUserId,
    });
    return response.data;
  },

  leaveGroup: async (conversationId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/leave`);
    return response.data;
  },

  updateGroupProfile: async (conversationId, payload) => {
    const response = await apiClient.patch(`/chat/conversations/${encodeURIComponent(conversationId)}/profile`, payload);
    return response.data;
  },

  deleteChatMessage: async (conversationId, messageId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
    );
    return response.data;
  },

  getThreadBootstrap: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/thread-bootstrap`,
      {
        params,
        signal: options?.signal,
      },
    );
    return response.data;
  },

  getMessages: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        params,
        signal: options?.signal,
      },
    );
    return response.data;
  },

  searchMessages: async (conversationId, params = {}) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/search`, { params });
    return response.data;
  },

  getShareableTasks: async (conversationId, params = {}) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/shareable-tasks`, { params });
    return response.data;
  },

  getConversationAssetsSummary: async (conversationId) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/assets-summary`);
    return response.data;
  },

  getConversationAttachments: async (conversationId, params = {}) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/attachments`, { params });
    return response.data;
  },

  createUploadSession: async (conversationId, payload, options = {}) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/upload-sessions`,
      payload,
      { signal: options?.signal },
    );
    return response.data;
  },

  uploadFileChunk: async (sessionId, fileId, chunkIndex, chunk, options = {}) => {
    const response = await apiClient.put(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/chunks/${encodeURIComponent(chunkIndex)}`,
      chunk,
      {
        params: {
          offset: Math.max(0, Number(options?.offset || 0)),
        },
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        signal: options?.signal,
      },
    );
    return response.data;
  },

  getUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.get(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  completeUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.post(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}/complete`,
      null,
      { signal: options?.signal },
    );
    return response.data;
  },

  cancelUploadSession: async (sessionId, options = {}) => {
    const response = await apiClient.delete(
      `/chat/upload-sessions/${encodeURIComponent(sessionId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  sendMessage: async (conversationId, body, options = {}) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      body,
      body_format: options?.body_format || undefined,
      client_message_id: options?.client_message_id || undefined,
      reply_to_message_id: options?.reply_to_message_id || undefined,
    });
    return response.data;
  },

  forwardMessage: async (conversationId, sourceMessageId, options = {}) => {
    const payload = {
      source_message_id: sourceMessageId,
    };
    const body = String(options?.body || '').trim();
    if (body) payload.body = body;
    if (options?.body_format) payload.body_format = options.body_format;
    if (options?.reply_to_message_id) payload.reply_to_message_id = options.reply_to_message_id;
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/forward`, payload);
    return response.data;
  },

  shareTask: async (conversationId, taskId, options = {}) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/messages/task-share`, {
      task_id: taskId,
      reply_to_message_id: options?.reply_to_message_id || undefined,
    });
    return response.data;
  },

  sendFiles: async (conversationId, files = [], options = {}) => {
    const normalizedFiles = (Array.isArray(files) ? files : [])
      .map((file) => normalizeChatUploadEntry(file))
      .filter(Boolean);
    const totalBytes = normalizedFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
    if (normalizedFiles.length === 0) {
      return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
    }

    if (!canUseChatUploadSessions(normalizedFiles)) {
      return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
    }

    let session = null;
    let sessionId = '';
    let completed = false;
    let loadedBytes = 0;
    const signal = options?.signal;
    emitChatUploadProgress(options?.onUploadProgress, 0, totalBytes);

    try {
      session = await chatAPI.createUploadSession(
        conversationId,
        {
          body: String(options?.body || '').trim() || undefined,
          reply_to_message_id: options?.reply_to_message_id || undefined,
          files: normalizedFiles.map((file) => ({
            file_name: String(file?.fileName || '').trim() || 'file.bin',
            mime_type: String(file?.mimeType || '').trim() || undefined,
            size: Number(file?.size || 0),
            original_size: Number(file?.originalSize || 0),
            transfer_encoding: String(file?.transferEncoding || 'identity').trim() || 'identity',
          })),
        },
        { signal },
      );
      sessionId = String(session?.session_id || '').trim();
      if (!sessionId || !Array.isArray(session?.files) || session.files.length !== normalizedFiles.length) {
        throw new Error('Chat upload session response is invalid');
      }
    } catch (error) {
      if (!signal?.aborted && shouldFallbackChatUploadSession(error)) {
        return uploadChatFilesMultipart(conversationId, normalizedFiles, options);
      }
      throw error;
    }

    const chunkSizeBytes = Math.max(1, Number(session?.chunk_size_bytes || CHAT_UPLOAD_SESSION_DEFAULT_CHUNK_BYTES));
    const uploadEntries = session.files.map((sessionFile, index) => ({
      file: normalizedFiles[index]?.transferFile,
      fileId: String(sessionFile?.file_id || '').trim(),
      size: Number(sessionFile?.size || normalizedFiles[index]?.size || 0),
      chunkCount: Math.max(1, Number(sessionFile?.chunk_count || Math.ceil((Number(sessionFile?.size || normalizedFiles[index]?.size || 0)) / chunkSizeBytes))),
      acknowledgedChunks: new Set(
        Array.isArray(sessionFile?.received_chunks)
          ? sessionFile.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
          : [],
      ),
    }));

    const syncLoadedBytes = () => {
      loadedBytes = uploadEntries.reduce((sum, entry) => (
        sum + Array.from(entry.acknowledgedChunks).reduce(
          (entrySum, chunkIndex) => entrySum + getChatChunkByteLength(chunkIndex, entry.size, chunkSizeBytes),
          0,
        )
      ), 0);
      emitChatUploadProgress(options?.onUploadProgress, loadedBytes, totalBytes);
    };

    const applySessionStatus = (statusPayload) => {
      const statusFiles = Array.isArray(statusPayload?.files) ? statusPayload.files : [];
      statusFiles.forEach((statusFile) => {
        const entry = uploadEntries.find((item) => item.fileId === String(statusFile?.file_id || '').trim());
        if (!entry) return;
        const receivedChunks = Array.isArray(statusFile?.received_chunks)
          ? statusFile.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
          : [];
        entry.acknowledgedChunks = new Set(receivedChunks);
      });
      syncLoadedBytes();
    };

    applySessionStatus(session);

    const uploadEntryChunks = async (entry) => {
      if (!entry.fileId) {
        throw new Error('Chat upload session file id is missing');
      }
      while (entry.acknowledgedChunks.size < entry.chunkCount) {
        let chunkIndex = -1;
        for (let index = 0; index < entry.chunkCount; index += 1) {
          if (!entry.acknowledgedChunks.has(index)) {
            chunkIndex = index;
            break;
          }
        }
        if (chunkIndex < 0) break;

        const offset = chunkIndex * chunkSizeBytes;
        const nextOffset = Math.min(entry.size, offset + chunkSizeBytes);
        const chunk = entry.file.slice(offset, nextOffset);
        let uploadSucceeded = false;

        for (let attempt = 0; attempt <= CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS.length; attempt += 1) {
          try {
            const chunkResult = await chatAPI.uploadFileChunk(
              sessionId,
              entry.fileId,
              chunkIndex,
              chunk,
              { offset, signal },
            );
            const receivedChunks = Array.isArray(chunkResult?.received_chunks)
              ? chunkResult.received_chunks.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0)
              : [chunkIndex];
            entry.acknowledgedChunks = new Set([
              ...Array.from(entry.acknowledgedChunks),
              ...receivedChunks,
            ]);
            syncLoadedBytes();
            uploadSucceeded = true;
            break;
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            try {
              const statusPayload = await chatAPI.getUploadSession(sessionId, { signal });
              applySessionStatus(statusPayload);
              if (entry.acknowledgedChunks.has(chunkIndex)) {
                uploadSucceeded = true;
                break;
              }
            } catch (statusError) {
              if (isAbortError(statusError)) {
                throw statusError;
              }
            }
            if (attempt >= CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS.length) {
              throw error;
            }
            await sleepWithSignal(CHAT_UPLOAD_SESSION_RETRY_DELAYS_MS[attempt], signal);
          }
        }

        if (!uploadSucceeded) {
          throw new Error('Chat upload chunk failed');
        }
      }
    };

    try {
      let cursor = 0;
      const workerCount = Math.min(CHAT_UPLOAD_SESSION_MAX_CONCURRENCY, uploadEntries.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < uploadEntries.length) {
          const currentIndex = cursor;
          cursor += 1;
          await uploadEntryChunks(uploadEntries[currentIndex]);
        }
      });
      await Promise.all(workers);
      syncLoadedBytes();
      const message = await chatAPI.completeUploadSession(sessionId, { signal });
      completed = true;
      emitChatUploadProgress(options?.onUploadProgress, totalBytes, totalBytes);
      return message;
    } catch (error) {
      if (sessionId && !completed && isAbortError(error)) {
        try {
          await chatAPI.cancelUploadSession(sessionId);
        } catch {
          // Ignore session cleanup failures on the client side.
        }
      }
      throw error;
    }
  },

  downloadAttachment: async (messageId, attachmentId) => {
    const response = await apiClient.get(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },

  getMessageReads: async (messageId) => {
    const response = await apiClient.get(`/chat/messages/${encodeURIComponent(messageId)}/reads`);
    return response.data;
  },

  markRead: async (conversationId, messageId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
      message_id: messageId,
    });
    return response.data;
  },
};

export const settingsAPI = {
  getMySettings: async (options = {}) => {
    const response = await apiClient.get('/settings/me', {
      suppressAuthRequired: Boolean(options?.suppressAuthRequired),
    });
    return response.data;
  },
  updateMySettings: async (payload) => {
    const response = await apiClient.patch('/settings/me', payload);
    return response.data;
  },
  getAppSettings: async () => {
    const response = await apiClient.get('/settings/app');
    return response.data;
  },
  updateAppSettings: async (payload) => {
    const response = await apiClient.patch('/settings/app', payload);
    return response.data;
  },
  getEnvSettings: async () => {
    const response = await apiClient.get('/settings/env');
    return response.data;
  },
  updateEnvSettings: async (items) => {
    const response = await apiClient.patch('/settings/env', { items });
    return response.data;
  },
  getNotificationPushConfig: async (options = {}) => {
    return getCachedGet(
      'settings-notification-push-config',
      '/settings/notifications/push-config',
      {
        staleTimeMs: PUSH_CONFIG_STALE_TIME_MS,
        force: Boolean(options?.force),
      },
    );
  },
  upsertNotificationPushSubscription: async (payload) => {
    const response = await apiClient.put('/settings/notifications/push-subscription', payload);
    return response.data;
  },
  deleteNotificationPushSubscription: async (endpoint) => {
    const response = await apiClient.delete('/settings/notifications/push-subscription', {
      data: { endpoint },
    });
    return response.data;
  },
  getNotificationPreferences: async () => {
    const response = await apiClient.get('/settings/notifications/preferences');
    return response.data;
  },
  updateNotificationPreferences: async (payload) => {
    const response = await apiClient.patch('/settings/notifications/preferences', payload);
    return response.data;
  },
  getAiBots: async () => {
    const response = await apiClient.get('/ai-bots');
    return response.data;
  },
  createAiBot: async (payload) => {
    const response = await apiClient.post('/ai-bots', payload);
    return response.data;
  },
  updateAiBot: async (botId, payload) => {
    const response = await apiClient.patch(`/ai-bots/${encodeURIComponent(botId)}`, payload);
    return response.data;
  },
  getAiBotRuns: async (botId) => {
    const response = await apiClient.get(`/ai-bots/${encodeURIComponent(botId)}/runs`);
    return response.data;
  },
};

export const databaseAPI = {
  getAvailableDatabases: async (options = {}) => (
    getCachedGet('database-list', '/database/list', {
      staleTimeMs: DATABASE_META_STALE_TIME_MS,
      force: Boolean(options?.force),
    })
  ),
  getCurrentDatabase: async (options = {}) => (
    getCachedGet('database-current', '/database/current', {
      staleTimeMs: DATABASE_META_STALE_TIME_MS,
      force: Boolean(options?.force),
    })
  ),
};

export const kbAPI = {
  getServices: async () => {
    const response = await apiClient.get('/kb/services');
    return response.data;
  },

  getCards: async (params = {}) => {
    const response = await apiClient.get('/kb/cards', { params });
    return response.data;
  },

  getCard: async (cardId) => {
    const response = await apiClient.get(`/kb/cards/${encodeURIComponent(cardId)}`);
    return response.data;
  },

  createCard: async (payload) => {
    const response = await apiClient.post('/kb/cards', payload);
    return response.data;
  },

  updateCard: async (cardId, payload) => {
    const response = await apiClient.patch(`/kb/cards/${encodeURIComponent(cardId)}`, payload);
    return response.data;
  },

  setCardStatus: async (cardId, payload) => {
    const response = await apiClient.post(`/kb/cards/${encodeURIComponent(cardId)}/status`, payload);
    return response.data;
  },

  getCategories: async () => {
    const response = await apiClient.get('/kb/categories');
    return response.data;
  },

  getArticles: async (params = {}) => {
    const response = await apiClient.get('/kb/articles', { params });
    return response.data;
  },

  getArticle: async (articleId) => {
    const response = await apiClient.get(`/kb/articles/${encodeURIComponent(articleId)}`);
    return response.data;
  },

  createArticle: async (payload) => {
    const response = await apiClient.post('/kb/articles', payload);
    return response.data;
  },

  updateArticle: async (articleId, payload) => {
    const response = await apiClient.patch(`/kb/articles/${encodeURIComponent(articleId)}`, payload);
    return response.data;
  },

  setArticleStatus: async (articleId, payload) => {
    const response = await apiClient.post(`/kb/articles/${encodeURIComponent(articleId)}/status`, payload);
    return response.data;
  },

  getFeed: async (params = {}) => {
    const response = await apiClient.get('/kb/feed', { params });
    return response.data;
  },

  uploadAttachment: async (articleId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post(`/kb/articles/${encodeURIComponent(articleId)}/attachments`, formData);
    return response.data;
  },

  downloadAttachment: async (articleId, attachmentId) => {
    const response = await apiClient.get(
      `/kb/articles/${encodeURIComponent(articleId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { responseType: 'blob' },
    );
    return response;
  },

  removeAttachment: async (articleId, attachmentId) => {
    const response = await apiClient.delete(
      `/kb/articles/${encodeURIComponent(articleId)}/attachments/${encodeURIComponent(attachmentId)}`
    );
    return response.data;
  },
};

export const departmentsAPI = {
  list: async (params = {}) => {
    const response = await apiClient.get('/departments', { params });
    return response.data;
  },

  getMembers: async (departmentId) => {
    const response = await apiClient.get(`/departments/${encodeURIComponent(departmentId)}/members`);
    return response.data;
  },

  setManagers: async (departmentId, managerUserIds = []) => {
    const response = await apiClient.put(`/departments/${encodeURIComponent(departmentId)}/managers`, {
      manager_user_ids: Array.isArray(managerUserIds) ? managerUserIds : [],
    });
    return response.data;
  },

  syncFromUsers: async () => {
    const response = await apiClient.post('/departments/sync-from-users');
    return response.data;
  },

  syncFromAD: async () => {
    const response = await apiClient.post('/departments/sync-from-ad');
    return response.data;
  },
};

export const hubAPI = {
  getDashboard: async (params = {}) => {
    const response = await apiClient.get('/hub/dashboard', { params });
    return response.data;
  },

  getAnnouncements: async (params = {}) => {
    const response = await apiClient.get('/hub/announcements', { params });
    return response.data;
  },

  getAnnouncement: async (announcementId) => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}`);
    return response.data;
  },

  createAnnouncement: async (payload, files = []) => {
    const hasFiles = Array.isArray(files) && files.length > 0;
    if (!hasFiles) {
      const response = await apiClient.post('/hub/announcements', payload);
      return response.data;
    }
    const formData = new FormData();
    formData.append('title', String(payload?.title || ''));
    formData.append('preview', String(payload?.preview || ''));
    formData.append('body', String(payload?.body || ''));
    formData.append('priority', String(payload?.priority || 'normal'));
    formData.append('audience_scope', String(payload?.audience_scope || 'all'));
    formData.append('audience_roles', JSON.stringify(Array.isArray(payload?.audience_roles) ? payload.audience_roles : []));
    formData.append('audience_user_ids', JSON.stringify(Array.isArray(payload?.audience_user_ids) ? payload.audience_user_ids : []));
    formData.append('requires_ack', payload?.requires_ack ? '1' : '0');
    formData.append('is_pinned', payload?.is_pinned ? '1' : '0');
    formData.append('pinned_until', String(payload?.pinned_until || ''));
    formData.append('published_from', String(payload?.published_from || ''));
    formData.append('expires_at', String(payload?.expires_at || ''));
    formData.append('is_active', payload?.is_active === false ? '0' : '1');
    files.forEach((file) => {
      if (file) {
        formData.append('files', file);
      }
    });
    const response = await apiClient.post('/hub/announcements', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  updateAnnouncement: async (announcementId, payload) => {
    const response = await apiClient.patch(`/hub/announcements/${encodeURIComponent(announcementId)}`, payload);
    return response.data;
  },

  deleteAnnouncement: async (announcementId) => {
    const response = await apiClient.delete(`/hub/announcements/${encodeURIComponent(announcementId)}`);
    return response.data;
  },

  markAnnouncementRead: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/mark-as-read`);
    return response.data;
  },

  acknowledgeAnnouncement: async (announcementId) => {
    const response = await apiClient.post(`/hub/announcements/${encodeURIComponent(announcementId)}/ack`);
    return response.data;
  },

  getAnnouncementReads: async (announcementId) => {
    const response = await apiClient.get(`/hub/announcements/${encodeURIComponent(announcementId)}/reads`);
    return response.data;
  },

  downloadAnnouncementAttachment: async (announcementId, attachmentId) => {
    const response = await apiClient.get(
      `/hub/announcements/${encodeURIComponent(announcementId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },

  getAssignees: async (params = {}) => {
    const response = await apiClient.get('/hub/users/assignees', { params });
    return response.data;
  },

  getControllers: async (params = {}) => {
    const response = await apiClient.get('/hub/users/controllers', { params });
    return response.data;
  },

  getTaskProjects: async (params = {}) => {
    const response = await apiClient.get('/hub/task-projects', { params });
    return response.data;
  },

  createTaskProject: async (payload) => {
    const response = await apiClient.post('/hub/task-projects', payload);
    return response.data;
  },

  updateTaskProject: async (projectId, payload) => {
    const response = await apiClient.patch(`/hub/task-projects/${encodeURIComponent(projectId)}`, payload);
    return response.data;
  },

  getTaskObjects: async (params = {}) => {
    const response = await apiClient.get('/hub/task-objects', { params });
    return response.data;
  },

  createTaskObject: async (payload) => {
    const response = await apiClient.post('/hub/task-objects', payload);
    return response.data;
  },

  updateTaskObject: async (objectId, payload) => {
    const response = await apiClient.patch(`/hub/task-objects/${encodeURIComponent(objectId)}`, payload);
    return response.data;
  },

  getAnnouncementRecipients: async () => {
    const response = await apiClient.get('/hub/users/announcement-recipients');
    return response.data;
  },

  transformMarkdown: async ({ text, context }) => {
    const response = await apiClient.post('/hub/markdown/transform', {
      text: String(text || ''),
      context: String(context || ''),
    });
    return response.data;
  },

  getTasks: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks', { params });
    return response.data;
  },

  getTaskAnalytics: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks/analytics', { params });
    return response.data;
  },

  exportTaskAnalyticsExcel: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks/analytics/export', {
      params,
      responseType: 'blob',
    });
    return response;
  },

  getTask: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}`);
    return response.data;
  },

  createTask: async (payload) => {
    const response = await apiClient.post('/hub/tasks', payload);
    return response.data;
  },

  updateTask: async (taskId, payload) => {
    const response = await apiClient.patch(`/hub/tasks/${encodeURIComponent(taskId)}`, payload);
    return response.data;
  },

  deleteTask: async (taskId) => {
    const response = await apiClient.delete(`/hub/tasks/${encodeURIComponent(taskId)}`);
    return response.data;
  },

  startTask: async (taskId) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/start`);
    return response.data;
  },

  submitTask: async ({ taskId, comment = '', file = null }) => {
    const formData = new FormData();
    formData.append('comment', String(comment || ''));
    if (file) {
      formData.append('file', file);
    }
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/submit`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  uploadTaskAttachment: async ({ taskId, file }) => {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/attachments`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  reviewTask: async (taskId, payload) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/review`, payload);
    return response.data;
  },

  downloadTaskAttachment: async ({ taskId, attachmentId }) => {
    const response = await apiClient.get(
      `/hub/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },

  downloadTaskReport: async (reportId) => {
    const response = await apiClient.get(`/hub/tasks/reports/${encodeURIComponent(reportId)}/file`, {
      responseType: 'blob',
    });
    return response;
  },

  getTaskComments: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}/comments`);
    return response.data;
  },

  addTaskComment: async (taskId, body) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/comments`, { body });
    return response.data;
  },

  markTaskCommentsSeen: async (taskId) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/comments/mark-seen`);
    return response.data;
  },

  getTaskStatusLog: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}/status-log`);
    return response.data;
  },

  pollNotifications: async (params = {}) => {
    const response = await apiClient.get('/hub/notifications/poll', { params });
    return response.data;
  },

  getUnreadCounts: async () => {
    const response = await apiClient.get('/hub/notifications/unread-counts');
    return response.data;
  },

  markNotificationRead: async (notificationId) => {
    const response = await apiClient.post(`/hub/notifications/${encodeURIComponent(notificationId)}/read`);
    return response.data;
  },

  markAllNotificationsRead: async () => {
    const response = await apiClient.post('/hub/notifications/read-all');
    return response.data;
  },
};

const normalizeMailboxId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const withMailboxQuery = (params = {}, mailboxId) => {
  const normalizedMailboxId = normalizeMailboxId(mailboxId ?? params?.mailbox_id ?? params?.mailboxId);
  const nextParams = { ...(params || {}) };
  delete nextParams.mailboxId;
  if (normalizedMailboxId) {
    nextParams.mailbox_id = normalizedMailboxId;
  } else {
    delete nextParams.mailbox_id;
  }
  return nextParams;
};

export const mailAPI = {
  getBootstrap: async (params = {}) => {
    const response = await apiClient.get('/mail/bootstrap', { params: withMailboxQuery(params) });
    return response.data;
  },
  getMessages: async (params = {}) => {
    const response = await apiClient.get('/mail/messages', { params: withMailboxQuery(params) });
    return response.data;
  },

  getInbox: async (params = {}) => {
    return mailAPI.getMessages(params);
  },

  getFolderSummary: async (params = {}) => {
    const response = await apiClient.get('/mail/folders/summary', { params: withMailboxQuery(params) });
    return response.data;
  },

  getFolderTree: async (params = {}) => {
    const response = await apiClient.get('/mail/folders/tree', { params: withMailboxQuery(params) });
    return response.data;
  },

  createFolder: async (payload) => {
    const response = await apiClient.post('/mail/folders', payload);
    return response.data;
  },

  renameFolder: async (folderId, payload = {}, mailboxId = '') => {
    const body = { ...(payload || {}) };
    const resolvedMailboxId = normalizeMailboxId(mailboxId || body?.mailbox_id);
    delete body.mailbox_id;
    const response = await apiClient.patch(
      `/mail/folders/${encodeURIComponent(folderId)}`,
      body,
      { params: withMailboxQuery({}, resolvedMailboxId) },
    );
    return response.data;
  },

  deleteFolder: async (folderId, mailboxId = '') => {
    const response = await apiClient.delete(
      `/mail/folders/${encodeURIComponent(folderId)}`,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  setFolderFavorite: async (folderId, favorite, mailboxId = '') => {
    const response = await apiClient.post(`/mail/folders/${encodeURIComponent(folderId)}/favorite`, {
      favorite,
      mailbox_id: normalizeMailboxId(mailboxId) || undefined,
    });
    return response.data;
  },

  searchContacts: async (q, options = {}) => {
    const response = await apiClient.get('/mail/contacts', {
      params: withMailboxQuery({ q }, options?.mailboxId),
    });
    return response.data?.items || [];
  },

  getMessage: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}`, {
      params: withMailboxQuery({}, options?.mailboxId),
      signal: options?.signal,
    });
    return response.data;
  },

  markAsRead: async (messageId, mailboxId = '') => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/read`,
      null,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  markAsUnread: async (messageId, mailboxId = '') => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/unread`,
      null,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  moveMessage: async (messageId, payload) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/move`, payload);
    return response.data;
  },

  deleteMessage: async (messageId, payload = {}) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/delete`, payload);
    return response.data;
  },

  restoreMessage: async (messageId, payload = {}) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/restore`, payload);
    return response.data;
  },

  bulkMessageAction: async (payload) => {
    const response = await apiClient.post('/mail/messages/bulk', payload);
    return response.data;
  },

  markAllRead: async (payload = {}) => {
    const response = await apiClient.post('/mail/messages/mark-all-read', payload);
    return response.data;
  },

  saveDraftMultipart: async ({
    fromMailboxId,
    draftId,
    composeMode,
    to,
    cc,
    bcc,
    subject,
    body,
    isHtml,
    replyToMessageId,
    forwardMessageId,
    retainExistingAttachments,
    files,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('from_mailbox_id', normalizeMailboxId(fromMailboxId));
    formData.append('draft_id', draftId || '');
    formData.append('compose_mode', composeMode || 'draft');
    formData.append('to', (to || []).join(';'));
    formData.append('cc', (cc || []).join(';'));
    formData.append('bcc', (bcc || []).join(';'));
    formData.append('subject', subject || '');
    formData.append('body', body || '');
    formData.append('is_html', isHtml ? 'true' : 'false');
    formData.append('reply_to_message_id', replyToMessageId || '');
    formData.append('forward_message_id', forwardMessageId || '');
    formData.append('retain_existing_attachments_json', JSON.stringify(retainExistingAttachments || []));
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }
    const response = await apiClient.post('/mail/drafts/upsert-multipart', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
    return response.data;
  },

  deleteDraft: async (draftId, options = {}) => {
    const response = await apiClient.delete(
      `/mail/drafts/${encodeURIComponent(draftId)}`,
      { params: withMailboxQuery({}, options?.mailboxId) },
    );
    return response.data;
  },

  getConversations: async (params = {}) => {
    const response = await apiClient.get('/mail/conversations', { params: withMailboxQuery(params) });
    return response.data;
  },

  getConversation: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(`/mail/conversations/${encodeURIComponent(conversationId)}`, {
      params: withMailboxQuery(params),
      signal: options?.signal,
    });
    return response.data;
  },

  markConversationAsRead: async (conversationId, payload = {}) => {
    const response = await apiClient.post(
      `/mail/conversations/${encodeURIComponent(conversationId)}/read`,
      payload,
    );
    return response.data;
  },

  markConversationAsUnread: async (conversationId, payload = {}) => {
    const response = await apiClient.post(
      `/mail/conversations/${encodeURIComponent(conversationId)}/unread`,
      payload,
    );
    return response.data;
  },

  getUnreadCount: async ({
    force = false,
    staleTimeMs = MAIL_UNREAD_COUNT_STALE_TIME_MS,
    mailboxId = '',
  } = {}) => {
    const normalizedMailboxId = normalizeMailboxId(mailboxId);
    if (normalizedMailboxId) {
      const response = await apiClient.get('/mail/unread-count', {
        params: { mailbox_id: normalizedMailboxId },
      });
      return response.data;
    }
    return getCachedGet(
      'mail-unread-count',
      '/mail/unread-count',
      {
        staleTimeMs,
        force,
      },
    );
  },

  getNotificationFeed: async (params = {}) => {
    const response = await apiClient.get('/mail/notifications/feed', { params });
    return response.data;
  },

  getPreferences: async () => {
    const response = await apiClient.get('/mail/preferences');
    return response.data;
  },

  updatePreferences: async (payload) => {
    const response = await apiClient.patch('/mail/preferences', payload);
    return response.data;
  },

  sendMessage: async (payload) => {
    const response = await apiClient.post('/mail/messages/send', payload);
    return response.data;
  },

  sendMessageMultipart: async ({
    fromMailboxId,
    to,
    cc,
    bcc,
    subject,
    body,
    isHtml,
    files,
    replyToMessageId,
    forwardMessageId,
    draftId,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('from_mailbox_id', normalizeMailboxId(fromMailboxId));
    formData.append('to', to.join(';'));
    formData.append('cc', (cc || []).join(';'));
    formData.append('bcc', (bcc || []).join(';'));
    formData.append('subject', subject || '');
    formData.append('body', body || '');
    formData.append('is_html', isHtml ? 'true' : 'false');
    formData.append('reply_to_message_id', replyToMessageId || '');
    formData.append('forward_message_id', forwardMessageId || '');
    formData.append('draft_id', draftId || '');
    if (files && files.length > 0) {
      files.forEach((file) => {
        formData.append('files', file);
      });
    }
    const response = await apiClient.post('/mail/messages/send-multipart', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
    return response.data;
  },

  downloadAttachment: async (messageId, attachmentRef, options = {}) => {
    const response = await apiClient.get(
      `/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentRef)}`,
      {
        params: withMailboxQuery({}, options?.mailboxId),
        responseType: 'blob',
      }
    );
    return response;
  },

  getMessageHeaders: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}/headers`, {
      params: withMailboxQuery({}, options?.mailboxId),
    });
    return response.data;
  },

  downloadMessageSource: async (messageId, options = {}) => {
    const response = await apiClient.get(`/mail/messages/${encodeURIComponent(messageId)}/eml`, {
      params: withMailboxQuery({}, options?.mailboxId),
      responseType: 'blob',
    });
    return response;
  },

  sendItRequest: async (payload) => {
    const response = await apiClient.post('/mail/messages/send-it-request', payload);
    return response.data;
  },

  sendItRequestMultipart: async ({
    templateId,
    fields,
    files,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('template_id', String(templateId || ''));
    formData.append('fields_json', JSON.stringify(fields || {}));
    if (Array.isArray(files) && files.length > 0) {
      files.forEach((file) => {
        if (file) {
          formData.append('files', file);
        }
      });
    }
    const response = await apiClient.post('/mail/messages/send-it-request-multipart', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
    return response.data;
  },

  getTemplates: async (params = {}) => {
    const response = await apiClient.get('/mail/templates', { params });
    return response.data;
  },

  createTemplate: async (payload) => {
    const response = await apiClient.post('/mail/templates', payload);
    return response.data;
  },

  updateTemplate: async (templateId, payload) => {
    const response = await apiClient.patch(`/mail/templates/${encodeURIComponent(templateId)}`, payload);
    return response.data;
  },

  deleteTemplate: async (templateId) => {
    const response = await apiClient.delete(`/mail/templates/${encodeURIComponent(templateId)}`);
    return response.data;
  },

  getMyConfig: async (params = {}) => {
    const response = await apiClient.get('/mail/config/me', { params: withMailboxQuery(params) });
    return response.data;
  },

  updateMyConfig: async (payload) => {
    const response = await apiClient.patch('/mail/config/me', payload);
    return response.data;
  },

  saveMyCredentials: async (payload) => {
    const response = await apiClient.post('/mail/config/me/credentials', payload);
    return response.data;
  },

  updateUserConfig: async (userId, payload) => {
    const response = await apiClient.patch(`/mail/config/user/${userId}`, payload);
    return response.data;
  },

  testConnection: async (payload = {}) => {
    const response = await apiClient.post('/mail/test-connection', payload);
    return response.data;
  },

  listMailboxes: async (options = {}) => {
    const params = {};
    if (typeof options?.includeUnread === 'boolean') {
      params.include_unread = options.includeUnread;
    }
    const response = await apiClient.get('/mail/mailboxes', { params });
    return response.data;
  },

  createMailbox: async (payload) => {
    const response = await apiClient.post('/mail/mailboxes', payload);
    return response.data;
  },

  updateMailbox: async (mailboxId, payload) => {
    const response = await apiClient.patch(`/mail/mailboxes/${encodeURIComponent(mailboxId)}`, payload);
    return response.data;
  },

  deleteMailbox: async (mailboxId) => {
    const response = await apiClient.delete(`/mail/mailboxes/${encodeURIComponent(mailboxId)}`);
    return response.data;
  },
};

export const networksAPI = {
  getBranches: async (city = 'tmn') => {
    const response = await apiClient.get('/networks/branches', { params: { city } });
    return response.data;
  },

  createBranch: async (payload) => {
    const response = await apiClient.post('/networks/branches', payload);
    return response.data;
  },

  updateBranch: async (branchId, data) => {
    const response = await apiClient.patch(`/networks/branches/${branchId}`, data);
    return response.data;
  },

  deleteBranch: async (branchId) => {
    const response = await apiClient.delete(`/networks/branches/${branchId}`);
    return response.data;
  },

  getBranchOverview: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/overview`);
    return response.data;
  },

  getDevices: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/devices`);
    return response.data;
  },

  getPorts: async (deviceId, params = {}) => {
    const response = await apiClient.get(`/networks/devices/${deviceId}/ports`, { params });
    return response.data;
  },

  getBranchPorts: async (branchId, params = {}) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/ports`, { params });
    return response.data;
  },

  getBranchSockets: async (branchId, params = {}) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/sockets`, { params });
    return response.data;
  },

  createSocket: async (branchId, payload) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets`, payload);
    return response.data;
  },

  updateSocket: async (socketId, payload) => {
    const response = await apiClient.patch(`/networks/sockets/${socketId}`, payload);
    return response.data;
  },

  deleteSocket: async (socketId) => {
    const response = await apiClient.delete(`/networks/sockets/${socketId}`);
    return response.data;
  },

  bootstrapSockets: async (branchId, payload = {}) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/bootstrap`, payload);
    return response.data;
  },

  importSocketsTemplate: async (branchId, formData) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/import`, formData);
    return response.data;
  },

  importEquipment: async (branchId, formData) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/equipment/import`, formData);
    return response.data;
  },

  getBranchDbMapping: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/db-mapping`);
    return response.data;
  },

  updateBranchDbMapping: async (branchId, payload) => {
    const response = await apiClient.patch(`/networks/branches/${branchId}/db-mapping`, payload);
    return response.data;
  },

  syncSocketHostContext: async (branchId, payload = {}) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/sync-host-context`, payload);
    return response.data;
  },

  resolveSocketFio: async (branchId, payload = {}) => {
    // Backward compatibility alias; prefer syncSocketHostContext in new code.
    return networksAPI.syncSocketHostContext(branchId, payload);
  },

  getMaps: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/maps`);
    return response.data;
  },

  getMapPoints: async (branchId, mapId = null) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/map-points`, {
      params: { map_id: mapId || undefined },
    });
    return response.data;
  },

  getAudit: async (params = {}) => {
    const response = await apiClient.get('/networks/audit', { params });
    return response.data;
  },

  importData: async (formData) => {
    const response = await apiClient.post('/networks/import', formData);
    return response.data;
  },

  createDevice: async (payload) => {
    const response = await apiClient.post('/networks/devices', payload);
    return response.data;
  },

  updateDevice: async (deviceId, payload) => {
    const response = await apiClient.patch(`/networks/devices/${deviceId}`, payload);
    return response.data;
  },

  deleteDevice: async (deviceId) => {
    const response = await apiClient.delete(`/networks/devices/${deviceId}`);
    return response.data;
  },

  bootstrapDevicePorts: async (deviceId, payload) => {
    const response = await apiClient.post(`/networks/devices/${deviceId}/bootstrap-ports`, payload);
    return response.data;
  },

  createPort: async (payload) => {
    const response = await apiClient.post('/networks/ports', payload);
    return response.data;
  },

  updatePort: async (portId, payload) => {
    const response = await apiClient.patch(`/networks/ports/${portId}`, payload);
    return response.data;
  },

  deletePort: async (portId) => {
    const response = await apiClient.delete(`/networks/ports/${portId}`);
    return response.data;
  },

  uploadMap: async (formData) => {
    const response = await apiClient.post('/networks/maps/upload', formData);
    return response.data;
  },

  updateMap: async (mapId, payload) => {
    const response = await apiClient.patch(`/networks/maps/${mapId}`, payload);
    return response.data;
  },

  deleteMap: async (mapId) => {
    const response = await apiClient.delete(`/networks/maps/${mapId}`);
    return response.data;
  },

  createMapPoint: async (payload) => {
    const response = await apiClient.post('/networks/map-points', payload);
    return response.data;
  },

  updateMapPoint: async (pointId, payload) => {
    const response = await apiClient.patch(`/networks/map-points/${pointId}`, payload);
    return response.data;
  },

  deleteMapPoint: async (pointId) => {
    const response = await apiClient.delete(`/networks/map-points/${pointId}`);
    return response.data;
  },

  downloadMapFile: async (mapId, params = {}) => {
    const response = await apiClient.get(`/networks/maps/${mapId}/file`, {
      params,
      responseType: 'blob',
    });
    return response;
  },

  exportMapPdf: async (mapId, params = {}) => {
    const response = await apiClient.get(`/networks/maps/${mapId}/export-pdf`, {
      params,
      responseType: 'blob',
    });
    return response;
  },
};

/**
 * Equipment API methods
 */
export const equipmentAPI = {
  getAgentComputers: async (options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const branch = String(options?.branch || '').trim();
    const status = String(options?.status || '').trim().toLowerCase();
    const outlookStatus = String(options?.outlookStatus || '').trim().toLowerCase();
    const searchQuery = String(options?.q || '').trim();
    const sortBy = String(options?.sortBy || '').trim();
    const sortDir = String(options?.sortDir || '').trim().toLowerCase();
    const changedOnly = Boolean(options?.changedOnly);
    const params = { scope };
    if (branch) {
      params.branch = branch;
    }
    if (['online', 'stale', 'offline', 'unknown'].includes(status)) {
      params.status = status;
    }
    if (['ok', 'warning', 'critical', 'unknown'].includes(outlookStatus)) {
      params.outlook_status = outlookStatus;
    }
    if (searchQuery) {
      params.q = searchQuery;
    }
    if (changedOnly) {
      params.changed_only = true;
    }
    if (sortBy) {
      params.sort_by = sortBy;
    }
    if (['asc', 'desc'].includes(sortDir)) {
      params.sort_dir = sortDir;
    }
    const response = await apiClient.get('/inventory/computers', {
      params,
    });
    return response.data;
  },

  searchAgentComputers: async (options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const branch = String(options?.branch || '').trim();
    const status = String(options?.status || '').trim().toLowerCase();
    const outlookStatus = String(options?.outlookStatus || '').trim().toLowerCase();
    const searchQuery = String(options?.q || '').trim();
    const searchFields = Array.isArray(options?.searchFields)
      ? options.searchFields.map((item) => String(item || '').trim()).filter(Boolean).join(',')
      : String(options?.searchFields || '').trim();
    const sortBy = String(options?.sortBy || '').trim();
    const sortDir = String(options?.sortDir || '').trim().toLowerCase();
    const changedOnly = Boolean(options?.changedOnly);
    const limit = Number(options?.limit || 50);
    const offset = Number(options?.offset || 0);
    const params = {
      scope,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50,
      offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
      include_summary: options?.includeSummary !== false,
    };
    if (branch) {
      params.branch = branch;
    }
    if (['online', 'stale', 'offline', 'unknown'].includes(status)) {
      params.status = status;
    }
    if (['ok', 'warning', 'critical', 'unknown'].includes(outlookStatus)) {
      params.outlook_status = outlookStatus;
    }
    if (searchQuery) {
      params.q = searchQuery;
    }
    if (searchFields) {
      params.search_fields = searchFields;
    }
    if (changedOnly) {
      params.changed_only = true;
    }
    if (sortBy) {
      params.sort_by = sortBy;
    }
    if (['asc', 'desc'].includes(sortDir)) {
      params.sort_dir = sortDir;
    }
    const response = await apiClient.get('/inventory/computers/search', {
      params,
    });
    return response.data;
  },

  getAgentComputerChanges: async (limit = 50) => {
    const response = await apiClient.get('/inventory/changes', {
      params: { limit },
    });
    return response.data;
  },

  searchBySerial: async (query) => {
    const response = await apiClient.get('/equipment/search/serial', {
      params: { q: query },
    });
    return response.data;
  },

  searchUniversal: async (query, page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/search/universal', {
      params: { q: query, page, limit },
    });
    return response.data;
  },

  searchByEmployee: async (query, page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/search/employee', {
      params: { q: query, page, limit },
    });
    return response.data;
  },

  getEmployeeEquipment: async (ownerNo) => {
    const response = await apiClient.get(`/equipment/employee/${ownerNo}/items`);
    return response.data;
  },

  getByInvNo: async (invNo) => {
    const response = await apiClient.get(`/equipment/${encodeURIComponent(String(invNo ?? ''))}`);
    return response.data;
  },

  getEquipmentActs: async (invNo) => {
    const response = await apiClient.get(`/equipment/${invNo}/acts`);
    return response.data;
  },

  getEquipmentHistory: async (invNo) => {
    const response = await apiClient.get(`/equipment/${encodeURIComponent(String(invNo ?? ''))}/history`);
    return response.data;
  },

  downloadEquipmentActFile: async (docNo, params = {}) => {
    const response = await apiClient.get(`/equipment/acts/${docNo}/file`, {
      params,
      responseType: 'blob',
    });
    return response;
  },

  parseUploadedAct: async (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const manualMode = Boolean(options?.manualMode);
    const response = await apiClient.post('/equipment/acts/upload/parse', formData, {
      params: manualMode ? { manual_mode: true } : undefined,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
    });
    return response.data;
  },

  getUploadedActDraft: async (draftId) => {
    const response = await apiClient.get(`/equipment/acts/upload/draft/${encodeURIComponent(draftId)}`);
    return response.data;
  },

  getTransferReminder: async (reminderId) => {
    const response = await apiClient.get(`/equipment/transfer/reminders/${encodeURIComponent(reminderId)}`);
    return response.data;
  },

  commitUploadedActDraft: async (payload) => {
    const response = await apiClient.post('/equipment/acts/upload/commit', payload);
    return response.data;
  },

  sendUploadedActEmail: async (payload) => {
    const response = await apiClient.post('/equipment/acts/upload/email', payload);
    return response.data;
  },

  getAllEquipment: async (page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/database', {
      params: { page, limit },
    });
    return response.data;
  },

  getAllEquipmentGrouped: async ({ page = 1, limit = 1000, branch } = {}) => {
    const response = await apiClient.get('/equipment/all-grouped', {
      params: { page, limit, branch: branch || undefined },
    });
    return response.data;
  },

  getAllConsumablesGrouped: async ({ page = 1, limit = 1000 } = {}) => {
    const response = await apiClient.get('/equipment/consumables-grouped', {
      params: { page, limit },
    });
    return response.data;
  },

  getByInvNos: async (invNos = []) => {
    const response = await apiClient.post('/equipment/by-inv-nos', {
      inv_nos: Array.isArray(invNos) ? invNos : [],
    });
    return response.data;
  },

  identifyWorkspace: async () => {
    const response = await apiClient.get('/discovery/identify-workspace');
    return response.data;
  },

  getBranches: async () => {
    const response = await apiClient.get('/equipment/branches');
    return response.data;
  },

  getBranchesList: async () => {
    const response = await apiClient.get('/equipment/branches-list');
    return response.data;
  },

  getLocations: async (branchNo) => {
    const normalizedBranchNo = branchNo === undefined || branchNo === null || String(branchNo).trim() === ''
      ? undefined
      : branchNo;
    const response = await apiClient.get('/equipment/locations', {
      params: normalizedBranchNo !== undefined ? { branch_no: normalizedBranchNo } : {},
    });
    return response.data;
  },

  getTypes: async () => {
    const response = await apiClient.get('/equipment/types');
    return response.data;
  },

  getModels: async (typeNo, ciType = 1) => {
    const response = await apiClient.get('/equipment/models', {
      params: { type_no: typeNo, ci_type: ciType },
    });
    return response.data;
  },

  getStatuses: async () => {
    const response = await apiClient.get('/equipment/statuses');
    return response.data;
  },

  searchOwners: async (query, limit = 20) => {
    const response = await apiClient.get('/equipment/owners/search', {
      params: { q: query, limit },
    });
    return response.data;
  },

  getOwnerDepartments: async (limit = 500) => {
    const response = await apiClient.get('/equipment/owners/departments', {
      params: { limit },
    });
    return response.data;
  },

  updateByInvNo: async (invNo, payload) => {
    const response = await apiClient.patch(`/equipment/${invNo}`, payload);
    return response.data;
  },

  deleteByInvNo: async (invNo) => {
    const response = await apiClient.delete(`/equipment/${invNo}`);
    return response.data;
  },

  createEquipment: async (payload) => {
    const response = await apiClient.post('/equipment/create', payload);
    return response.data;
  },

  createConsumable: async (payload) => {
    const response = await apiClient.post('/equipment/consumables/create', payload);
    return response.data;
  },

  lookupConsumables: async (params = {}) => {
    const response = await apiClient.get('/equipment/consumables/lookup', { params });
    return response.data;
  },

  consumeConsumable: async (payload) => {
    const response = await apiClient.post('/equipment/consumables/consume', payload);
    return response.data;
  },

  updateConsumableQty: async (payload) => {
    const response = await apiClient.patch('/equipment/consumables/qty', payload);
    return response.data;
  },

  transfer: async (payload) => {
    const response = await apiClient.post('/equipment/transfer', payload);
    return response.data;
  },

  createTransferActOnly: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/act-only', payload);
    return response.data;
  },

  getTransferActJob: async (jobId) => {
    const response = await apiClient.get(`/equipment/transfer/act-jobs/${encodeURIComponent(jobId)}`);
    return response.data;
  },

  sendTransferActsEmail: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/email', payload);
    return response.data;
  },

  downloadTransferAct: async (actId) => {
    const response = await apiClient.get(`/equipment/transfer/act/${actId}`, {
      responseType: 'blob',
    });
    return response;
  },
};

export const mfuAPI = {
  getDevices: async (params = {}) => {
    const response = await apiClient.get('/mfu/devices', { params });
    return response.data;
  },
  getMonthlyPages: async (params = {}) => {
    const response = await apiClient.get('/mfu/pages/monthly', { params });
    return response.data;
  },
};

const normalizeScanHost = (value) => String(value || '').trim().toUpperCase();

const toUnixTs = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed / 1000);
};

const severityRank = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  if (normalized === 'low') return 1;
  return 0;
};

const aggregateHostsFromIncidents = (items) => {
  const source = Array.isArray(items) ? items : [];
  const map = new Map();

  source.forEach((incident) => {
    const hostname = normalizeScanHost(incident?.hostname);
    if (!hostname) return;

    if (!map.has(hostname)) {
      map.set(hostname, {
        hostname,
        incidents_total: 0,
        incidents_new: 0,
        last_incident_at: 0,
        top_severity: 'none',
        extMap: new Map(),
        sourceKindMap: new Map(),
      });
    }

    const entry = map.get(hostname);
    entry.incidents_total += 1;

    const status = String(incident?.status || '').toLowerCase();
    if (status !== 'acknowledged') {
      entry.incidents_new += 1;
    }

    const ts = toUnixTs(incident?.created_at || incident?.detected_at || incident?.updated_at);
    if (ts > entry.last_incident_at) {
      entry.last_incident_at = ts;
    }

    const rank = severityRank(incident?.severity);
    if (rank > severityRank(entry.top_severity)) {
      entry.top_severity = rank === 3 ? 'high' : rank === 2 ? 'medium' : rank === 1 ? 'low' : 'none';
    }

    const ext = String(incident?.file_ext || incident?.extension || '').trim().toLowerCase();
    if (ext) {
      entry.extMap.set(ext, (entry.extMap.get(ext) || 0) + 1);
    }

    const sourceKind = String(incident?.source_kind || incident?.source || '').trim().toLowerCase();
    if (sourceKind) {
      entry.sourceKindMap.set(sourceKind, (entry.sourceKindMap.get(sourceKind) || 0) + 1);
    }
  });

  return Array.from(map.values()).map((entry) => {
    const topExts = Array.from(entry.extMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([ext]) => ext);

    const topSourceKinds = Array.from(entry.sourceKindMap.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([kind]) => kind);

    return {
      hostname: entry.hostname,
      incidents_total: entry.incidents_total,
      incidents_new: entry.incidents_new,
      last_incident_at: entry.last_incident_at,
      top_severity: entry.top_severity,
      top_exts: topExts,
      top_source_kinds: topSourceKinds,
    };
  });
};

const getHostsFallbackFromIncidents = async (params = {}) => {
  const limitValue = Number(params?.limit || 300);
  const incidentLimit = Number.isFinite(limitValue) ? Math.max(limitValue * 4, 500) : 500;
  const response = await apiClient.get('/scan/incidents', {
    params: { limit: incidentLimit, offset: 0 },
  });
  const items = response?.data?.items;
  return aggregateHostsFromIncidents(items);
};

export const scanAPI = {
  getDashboard: async () => {
    const response = await apiClient.get('/scan/dashboard');
    return response.data;
  },

  getBranches: async () => {
    const response = await apiClient.get('/scan/branches');
    return response.data;
  },

  getHostsTable: async (params = {}) => {
    const response = await apiClient.get('/scan/hosts/table', { params });
    return response.data;
  },

  getHosts: async (params = {}) => {
    if (scanHostsEndpointUnavailable) {
      return getHostsFallbackFromIncidents(params);
    }
    try {
      const response = await apiClient.get('/scan/hosts', { params });
      return response.data;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (statusCode !== 404) {
        throw error;
      }
      markScanHostsUnavailable(true);
      return getHostsFallbackFromIncidents(params);
    }
  },

  getIncidents: async (params = {}, options = {}) => {
    const response = await apiClient.get('/scan/incidents', { params, signal: options?.signal });
    return response.data;
  },

  getHostScanRuns: async (hostname, params = {}) => {
    const response = await apiClient.get(`/scan/hosts/${encodeURIComponent(hostname)}/scan-runs`, { params });
    return response.data;
  },

  getTaskObservations: async (taskId, params = {}) => {
    const response = await apiClient.get(`/scan/tasks/${encodeURIComponent(taskId)}/observations`, { params });
    return response.data;
  },

  exportScanTaskIncidents: async (taskId) => {
    const response = await apiClient.get(`/scan/tasks/${encodeURIComponent(taskId)}/incidents/export`, {
      responseType: 'blob',
    });
    return response;
  },

  getPatterns: async () => {
    const response = await apiClient.get('/scan/patterns');
    return response.data;
  },

  ackIncident: async (incidentId, ackBy = '') => {
    const response = await apiClient.post(`/scan/incidents/${encodeURIComponent(incidentId)}/ack`, {
      ack_by: ackBy,
    });
    return response.data;
  },

  ackIncidentsBatch: async (payload = {}) => {
    const response = await apiClient.post('/scan/incidents/bulk-ack', payload);
    return response.data;
  },

  getAgents: async () => {
    const response = await apiClient.get('/scan/agents');
    return response.data;
  },

  getAgentsTable: async (params = {}) => {
    const response = await apiClient.get('/scan/agents/table', { params });
    return response.data;
  },

  getAgentsActivity: async (agentIds = []) => {
    const query = new URLSearchParams();
    (Array.isArray(agentIds) ? agentIds : []).forEach((agentId) => {
      const normalized = String(agentId || '').trim();
      if (normalized) query.append('agent_id', normalized);
    });
    const suffix = query.toString();
    const response = await apiClient.get(
      suffix ? `/scan/agents/activity?${suffix}` : '/scan/agents/activity',
    );
    return response.data;
  },

  getTasks: async (params = {}) => {
    const response = await apiClient.get('/scan/tasks', { params });
    return response.data;
  },

  createTask: async (payload) => {
    const response = await apiClient.post('/scan/tasks', payload);
    return response.data;
  },
};

/**
 * AD Users API
 */
export const adUsersAPI = {
  getPasswordStatus: async () => {
    const { data } = await apiClient.get('/ad-users/password-status');
    return data;
  },
  getImportCandidates: async () => {
    const { data } = await apiClient.get('/ad-users/import-candidates');
    return data;
  },
  importToApp: async (login) => {
    const { data } = await apiClient.post('/ad-users/import-to-app', { login });
    return data;
  },
  syncToApp: async (logins = []) => {
    const { data } = await apiClient.post('/ad-users/sync-to-app', {
      logins: Array.isArray(logins) ? logins : [],
    });
    return data;
  },
  assignBranch: async (payload) => {
    const { data } = await apiClient.post('/ad-users/assign-branch', payload);
    return data;
  }
};

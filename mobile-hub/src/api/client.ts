import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_V1_BASE, CLIENT_DEVICE_HEADER, MOBILE_AUTH_HEADER, MOBILE_AUTH_VALUE } from './config';
import * as tokenStore from '../auth/tokenStore';
import { publishSessionExpired } from '../auth/sessionEvents';
import {
  createNativeOfflineReadOnlyError,
  isNativeOfflineMutationBlocked,
} from '../offline/nativeOfflinePolicy';

type RetryConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _hubitDeadlineAtMs?: number;
  hubitTotalTimeoutMs?: number;
};

const AUTH_REFRESH_TIMEOUT_MS = 30_000;
const MAIL_EXCHANGE_TIMEOUT_MS = 120_000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

const apiClient = axios.create({
  baseURL: API_V1_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

function remainingTotalTimeoutMs(config: RetryConfig): number | null {
  const total = Number(config.hubitTotalTimeoutMs || 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(config._hubitDeadlineAtMs) || Number(config._hubitDeadlineAtMs) <= 0) {
    config._hubitDeadlineAtMs = Date.now() + Math.max(1, Math.trunc(total));
  }
  return Math.max(0, Math.trunc(Number(config._hubitDeadlineAtMs) - Date.now()));
}

function applyRemainingTotalTimeout(config: RetryConfig): void {
  const remaining = remainingTotalTimeoutMs(config);
  if (remaining === null) return;
  const requested = Number(config.timeout || 0);
  config.timeout = Math.max(1, Math.min(
    remaining,
    Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : remaining,
  ));
}

function createTotalTimeoutError(config: RetryConfig): Error {
  return Object.assign(new Error(`timeout of ${Number(config.hubitTotalTimeoutMs || 0)}ms exceeded`), {
    code: 'ECONNABORTED',
    config,
    isAxiosError: true,
    response: undefined,
  });
}

apiClient.interceptors.request.use(async (config) => {
  applyRemainingTotalTimeout(config as RetryConfig);
  if (isNativeOfflineMutationBlocked(config.method)) {
    throw createNativeOfflineReadOnlyError();
  }
  // Let RN/axios set multipart boundary. A bare "multipart/form-data" header
  // without boundary makes FastAPI see zero files and reject chat uploads.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const headers = config.headers;
    if (headers?.delete) {
      headers.delete('Content-Type');
      headers.delete('content-type');
    } else if (headers?.set) {
      headers.set('Content-Type', undefined as unknown as string);
      headers.set('content-type', undefined as unknown as string);
    } else if (headers) {
      delete (headers as Record<string, unknown>)['Content-Type'];
      delete (headers as Record<string, unknown>)['content-type'];
    }
  }
  if (
    String(config.url || '').split('?')[0].startsWith('/mail/')
    && Number(config.timeout || 0) < MAIL_EXCHANGE_TIMEOUT_MS
  ) {
    config.timeout = MAIL_EXCHANGE_TIMEOUT_MS;
  }
  const accessToken = await tokenStore.getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  applyRemainingTotalTimeout(config as RetryConfig);
  return config;
});

let refreshPromise: Promise<string | null> | null = null;
let expireSessionPromise: Promise<void> | null = null;

function isAuthRequestWithoutRefresh(url: string | undefined): boolean {
  const normalized = String(url || '').split('?')[0];
  return [
    '/auth/login',
    '/auth/enable-2fa',
    '/auth/verify-2fa',
    '/auth/verify-2fa-login',
    '/auth/mobile-biometric/session',
    '/auth/refresh',
    '/auth/logout',
  ].some((path) => normalized.endsWith(path));
}

async function expireSession(): Promise<void> {
  if (!expireSessionPromise) {
    expireSessionPromise = tokenStore.clearTokens()
      .finally(() => {
        publishSessionExpired();
      })
      .finally(() => {
        expireSessionPromise = null;
      });
  }
  await expireSessionPromise;
}

function boundedRefreshTimeout(timeoutMs?: number): number {
  const requested = Number(timeoutMs || 0);
  if (!Number.isFinite(requested) || requested <= 0) return AUTH_REFRESH_TIMEOUT_MS;
  return Math.min(AUTH_REFRESH_TIMEOUT_MS, Math.max(1, Math.trunc(requested)));
}

async function refreshAccessToken(timeoutMs?: number): Promise<string | null> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return null;
  const clientDeviceId = await tokenStore.getClientDeviceId();
  const response = await axios.post(
    `${API_V1_BASE}/auth/refresh`,
    { refresh_token: refreshToken },
    {
      timeout: boundedRefreshTimeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        [MOBILE_AUTH_HEADER]: MOBILE_AUTH_VALUE,
        ...(clientDeviceId ? { [CLIENT_DEVICE_HEADER]: clientDeviceId } : {}),
      },
    },
  );
  const access = String(response.data?.access_token || '').trim();
  const refresh = String(response.data?.refresh_token || '').trim();
  if (!access || !refresh) throw new Error('Incomplete mobile refresh response');
  await tokenStore.setTokens(access, refresh);
  return access;
}

function accessTokenExpiresSoon(accessToken: string): boolean {
  const payload = String(accessToken || '').split('.')[1];
  if (!payload || typeof globalThis.atob !== 'function') return false;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = globalThis.atob(`${normalized}${'='.repeat(-normalized.length & 3)}`);
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    const expiresAt = Number(parsed.exp || 0) * 1000;
    return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS;
  } catch {
    return false;
  }
}

async function sharedRefreshAccessToken(timeoutMs?: number): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(timeoutMs).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function getAuthenticatedAccessToken(
  options: {
    forceRefresh?: boolean;
    preserveSessionOnRefreshFailure?: boolean;
    refreshTimeoutMs?: number;
  } = {},
): Promise<string> {
  const currentAccessToken = String((await tokenStore.getAccessToken()) || '').trim();
  const shouldRefresh = Boolean(options.forceRefresh) || !currentAccessToken || accessTokenExpiresSoon(currentAccessToken);
  if (!shouldRefresh) return currentAccessToken;

  let refreshedAccessToken: string | null = null;
  try {
    refreshedAccessToken = await sharedRefreshAccessToken(options.refreshTimeoutMs);
  } catch (refreshError) {
    if (axios.isAxiosError(refreshError) && !refreshError.response) {
      if (currentAccessToken && !options.forceRefresh) return currentAccessToken;
      throw refreshError;
    }
    const status = axios.isAxiosError(refreshError) ? refreshError.response?.status : undefined;
    if ((status === 401 || status === 403) && !options.preserveSessionOnRefreshFailure) {
      await expireSession();
    }
    throw refreshError;
  }
  if (!refreshedAccessToken) {
    if (!options.preserveSessionOnRefreshFailure) await expireSession();
    throw new Error('Authenticated mobile session expired');
  }
  return refreshedAccessToken;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    if (!config || config._retry || error.response?.status !== 401) {
      return Promise.reject(error);
    }
    if (isAuthRequestWithoutRefresh(config.url)) {
      return Promise.reject(error);
    }
    config._retry = true;
    const refreshBudget = remainingTotalTimeoutMs(config);
    if (refreshBudget !== null && refreshBudget <= 0) {
      return Promise.reject(createTotalTimeoutError(config));
    }
    let newAccess: string | null = null;
    try {
      newAccess = await getAuthenticatedAccessToken({
        forceRefresh: true,
        refreshTimeoutMs: refreshBudget ?? (Number(config.timeout || 0) || undefined),
      });
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
    const retryBudget = remainingTotalTimeoutMs(config);
    if (retryBudget !== null && retryBudget <= 0) {
      return Promise.reject(createTotalTimeoutError(config));
    }
    if (retryBudget !== null) config.timeout = Math.max(1, retryBudget);
    config.headers.Authorization = `Bearer ${newAccess}`;
    return apiClient(config);
  },
);

export function withMobileAuthHeaders(clientDeviceId?: string | null) {
  return {
    [MOBILE_AUTH_HEADER]: MOBILE_AUTH_VALUE,
    ...(clientDeviceId ? { [CLIENT_DEVICE_HEADER]: clientDeviceId } : {}),
  };
}

export default apiClient;

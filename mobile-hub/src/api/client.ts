import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_V1_BASE, MOBILE_AUTH_HEADER, MOBILE_AUTH_VALUE } from './config';
import * as tokenStore from '../auth/tokenStore';

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const apiClient = axios.create({
  baseURL: API_V1_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(async (config) => {
  const accessToken = await tokenStore.getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return null;
  const response = await axios.post(
    `${API_V1_BASE}/auth/refresh`,
    { refresh_token: refreshToken },
    {
      headers: {
        'Content-Type': 'application/json',
        [MOBILE_AUTH_HEADER]: MOBILE_AUTH_VALUE,
      },
    },
  );
  const access = String(response.data?.access_token || '').trim();
  const refresh = String(response.data?.refresh_token || '').trim();
  if (!access || !refresh) return null;
  await tokenStore.setTokens(access, refresh);
  return access;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined;
    if (!config || config._retry || error.response?.status !== 401) {
      return Promise.reject(error);
    }
    if (String(config.url || '').includes('/auth/login')) {
      return Promise.reject(error);
    }
    config._retry = true;
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const newAccess = await refreshPromise;
    if (!newAccess) {
      await tokenStore.clearTokens();
      return Promise.reject(error);
    }
    config.headers.Authorization = `Bearer ${newAccess}`;
    return apiClient(config);
  },
);

export function withMobileAuthHeaders() {
  return { [MOBILE_AUTH_HEADER]: MOBILE_AUTH_VALUE };
}

export default apiClient;

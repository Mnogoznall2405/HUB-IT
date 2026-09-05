import axios, { type InternalAxiosRequestConfig } from 'axios';
import apiClient, { getAuthenticatedAccessToken } from './client';
import * as tokenStore from '../auth/tokenStore';
import { subscribeSessionExpired } from '../auth/sessionEvents';
import { setNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';

const originalAdapter = apiClient.defaults.adapter;

function response(config: unknown, data: unknown, status = 200) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    headers: {},
    config,
  };
}

function unauthorized(config: unknown) {
  return Promise.reject({
    config,
    response: response(config, {}, 401),
    isAxiosError: true,
  });
}

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  setNativeOfflineReadOnly(false);
  jest.restoreAllMocks();
});

describe('mobile API refresh', () => {
  it('keeps using a still-valid access token when proactive refresh cannot reach the server', async () => {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 30 })).toString('base64url');
    const accessToken = `header.${payload}.signature`;
    await tokenStore.setTokens(accessToken, 'offline-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      code: 'ERR_NETWORK',
      message: 'Network Error',
      response: undefined,
    });

    await expect(getAuthenticatedAccessToken()).resolves.toBe(accessToken);
    expect(await tokenStore.getRefreshToken()).toBe('offline-refresh');
  });

  it('coalesces forced refreshes used by protected native media', async () => {
    await tokenStore.setTokens('expired-access', 'refresh-token');
    const refresh = jest.spyOn(axios, 'post').mockResolvedValue(response({}, {
      access_token: 'media-access',
      refresh_token: 'media-refresh',
    }) as never);

    const [first, second] = await Promise.all([
      getAuthenticatedAccessToken({ forceRefresh: true }),
      getAuthenticatedAccessToken({ forceRefresh: true }),
    ]);

    expect(first).toBe('media-access');
    expect(second).toBe('media-access');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ timeout: 30_000 }));
  });

  it('keeps the session when a speculative protected-media refresh is rejected', async () => {
    await tokenStore.setTokens('current-access', 'current-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, {}, 401),
    });
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(getAuthenticatedAccessToken({
      forceRefresh: true,
      preserveSessionOnRefreshFailure: true,
    })).rejects.toBeTruthy();

    expect(await tokenStore.getAccessToken()).toBe('current-access');
    expect(await tokenStore.getRefreshToken()).toBe('current-refresh');
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('uses a single refresh for parallel 401 responses', async () => {
    await tokenStore.setTokens('old-access', 'refresh-token');
    const refresh = jest.spyOn(axios, 'post').mockResolvedValue(response({}, {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }) as never);
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const authorization = String(config.headers?.Authorization || '');
      if (authorization === 'Bearer old-access') return unauthorized(config);
      return response(config, { ok: true });
    }) as never;

    const [first, second] = await Promise.all([
      apiClient.get('/protected-one'),
      apiClient.get('/protected-two'),
    ]);

    expect(first.data).toEqual({ ok: true });
    expect(second.data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await tokenStore.getAccessToken()).toBe('new-access');
  });

  it('bounds a session bootstrap refresh by the original auth request timeout', async () => {
    await tokenStore.setTokens('expired-access', 'refresh-token');
    const refresh = jest.spyOn(axios, 'post').mockResolvedValue(response({}, {
      access_token: 'bootstrap-access',
      refresh_token: 'bootstrap-refresh',
    }) as never);
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const authorization = String(config.headers?.Authorization || '');
      if (authorization === 'Bearer expired-access') return unauthorized(config);
      return response(config, { ok: true });
    }) as never;

    await apiClient.get('/auth/me', { timeout: 5_000 });

    expect(refresh.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ timeout: 5_000 }));
  });

  it('keeps a session bootstrap refresh and retry inside one total timeout budget', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await tokenStore.setTokens('expired-access', 'refresh-token');
    const refresh = jest.spyOn(axios, 'post').mockImplementation(async () => {
      now = 4_500;
      return response({}, {
        access_token: 'bootstrap-access',
        refresh_token: 'bootstrap-refresh',
      }) as never;
    });
    let retryTimeout = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const authorization = String(config.headers?.Authorization || '');
      if (authorization === 'Bearer expired-access') {
        now = 4_000;
        return unauthorized(config);
      }
      retryTimeout = Number(config.timeout || 0);
      return response(config, { ok: true });
    }) as never;

    await apiClient.get('/auth/me', {
      timeout: 5_000,
      hubitTotalTimeoutMs: 5_000,
    } as never);

    expect(refresh.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ timeout: 2_000 }));
    expect(retryTimeout).toBe(1_500);
  });

  it('clears the session and publishes one event when refresh rejects credentials', async () => {
    await tokenStore.setTokens('expired-access', 'expired-refresh');
    await tokenStore.setSessionUserId(38);
    await writeNativeSnapshot('dashboard', 38, { prepared: true });
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, {}, 401),
    });
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never;
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();

    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(await tokenStore.getRefreshToken()).toBeNull();
    await expect(readNativeSnapshot('dashboard', 38)).resolves.toEqual(
      expect.objectContaining({ data: { prepared: true } }),
    );
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps local credentials when refresh fails only because the network is unavailable', async () => {
    await tokenStore.setTokens('expired-access', 'offline-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      code: 'ERR_NETWORK',
      message: 'Network Error',
      response: undefined,
    });
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never;
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(apiClient.get('/protected')).rejects.toMatchObject({ code: 'ERR_NETWORK' });

    expect(await tokenStore.getAccessToken()).toBe('expired-access');
    expect(await tokenStore.getRefreshToken()).toBe('offline-refresh');
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it.each([429, 500, 502, 503])('preserves credentials and propagates refresh HTTP %s', async (status) => {
    await tokenStore.setTokens('expired-access', 'retryable-refresh');
    const refreshError = { isAxiosError: true, response: response({}, {}, status) };
    jest.spyOn(axios, 'post').mockRejectedValue(refreshError);
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never;
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    try {
      await expect(apiClient.get('/auth/me')).rejects.toBe(refreshError);
      expect(await tokenStore.getRefreshToken()).toBe('retryable-refresh');
      expect(await tokenStore.getAccessToken()).toBe('expired-access');
      expect(expired).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('preserves credentials when a successful refresh response is incomplete', async () => {
    await tokenStore.setTokens('expired-access', 'retryable-refresh');
    jest.spyOn(axios, 'post').mockResolvedValue(response({}, {}) as never);
    await expect(getAuthenticatedAccessToken({ forceRefresh: true })).rejects.toBeTruthy();
    expect(await tokenStore.getRefreshToken()).toBe('retryable-refresh');
  });

  it('does not recurse on refresh and logout endpoints', async () => {
    await tokenStore.setTokens('expired-access', 'expired-refresh');
    const refresh = jest.spyOn(axios, 'post');
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never;

    await expect(apiClient.post('/auth/logout')).rejects.toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears multipart Content-Type so React Native can set the boundary', async () => {
    await tokenStore.setTokens('access-token', 'refresh-token');
    let seenHeaders: InternalAxiosRequestConfig['headers'] | undefined;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      seenHeaders = config.headers;
      return response(config, { ok: true });
    }) as never;

    const formData = new FormData();
    formData.append('files', 'x');
    await apiClient.post('/chat/conversations/c1/messages/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const contentType = String(
      seenHeaders?.get?.('Content-Type')
      || seenHeaders?.['Content-Type']
      || seenHeaders?.['content-type']
      || '',
    );
    expect(contentType).not.toBe('multipart/form-data');
    expect(String(seenHeaders?.Authorization || seenHeaders?.get?.('Authorization') || '')).toContain('access-token');
  });

  it('blocks every native mutation before transport while the authenticated session is offline', async () => {
    const adapter = jest.fn(async (config: InternalAxiosRequestConfig) => response(config, { ok: true }));
    apiClient.defaults.adapter = adapter as never;
    setNativeOfflineReadOnly(true);

    await expect(apiClient.post('/profile/avatar', { value: 'unsafe' })).rejects.toMatchObject({
      code: 'HUBIT_OFFLINE_READ_ONLY',
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});

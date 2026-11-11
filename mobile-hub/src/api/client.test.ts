import axios, { type InternalAxiosRequestConfig } from 'axios';
import apiClient, {
  getAuthenticatedAccessToken,
  isDefinitiveAuthRejection,
  isNetworkRestrictedRejection,
  isUserDeactivatedRejection,
} from './client';
import * as tokenStore from '../auth/tokenStore';
import { subscribeSessionExpired } from '../auth/sessionEvents';
import { setNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import { readNativeSnapshot, writeNativeSnapshot } from '../cache/nativeSnapshotCache';
import { getApiInflightSummary, resetApiInflight } from '../diagnostics/apiInflight';

const originalAdapter = apiClient.defaults.adapter;

function response(config: unknown, data: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    headers,
    config,
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };

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
      response: response({}, {}, 401, JSON_HEADERS),
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
      response: response({}, {}, 401, JSON_HEADERS),
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

  it.each([401, 403])('keeps credentials when refresh %s arrives without a JSON body', async (status) => {
    await tokenStore.setTokens('expired-access', 'proxied-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, '<html>blocked</html>', status, { 'content-type': 'text/html' }),
    });
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never;
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(apiClient.get('/protected')).rejects.toBeTruthy();

    // An equally coded HTML page from IIS, a captive portal or a WAF is not a
    // HUB-IT refusal: the session survives and stays retryable.
    expect(await tokenStore.getAccessToken()).toBe('expired-access');
    expect(await tokenStore.getRefreshToken()).toBe('proxied-refresh');
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('wipes tokens, offline data and marks the account when refresh reports user_inactive', async () => {
    await tokenStore.setTokens('expired-access', 'deactivated-refresh');
    await tokenStore.setSessionUserId(38);
    await writeNativeSnapshot('dashboard', 38, { prepared: true });
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, { detail: 'User is not active' }, 401, {
        'content-type': 'application/json',
        'x-hubit-auth-reason': 'user_inactive',
      }),
    });
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(getAuthenticatedAccessToken({ forceRefresh: true })).rejects.toBeTruthy();

    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(await tokenStore.getRefreshToken()).toBeNull();
    expect(await tokenStore.getSessionUserId()).toBeNull();
    // Unlike an ordinary expiry, a deactivated account loses the encrypted
    // snapshot and its keys — the mark survives a cold start.
    await expect(readNativeSnapshot('dashboard', 38)).resolves.toBeNull();
    expect(tokenStore.isSessionDeactivationMarked()).toBe(true);
    await expect(tokenStore.readSessionDeactivationMark()).resolves.toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('wipes a deactivated session even for a preserve-session refresh caller', async () => {
    await tokenStore.setTokens('expired-access', 'deactivated-refresh');
    await tokenStore.setSessionUserId(38);
    await writeNativeSnapshot('dashboard', 38, { prepared: true });
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, { detail: 'User is not active' }, 401, {
        'content-type': 'application/json',
        'x-hubit-auth-reason': 'user_inactive',
      }),
    });
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(getAuthenticatedAccessToken({
      forceRefresh: true,
      preserveSessionOnRefreshFailure: true,
    })).rejects.toBeTruthy();

    expect(await tokenStore.getAccessToken()).toBeNull();
    await expect(readNativeSnapshot('dashboard', 38)).resolves.toBeNull();
    expect(tokenStore.isSessionDeactivationMarked()).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the session on a JSON 403 refresh rejection from HUB-IT', async () => {
    // The refresh handler never emits 403, and the admin IP allowlist 403 only
    // restricts the current network — the session stays valid elsewhere.
    await tokenStore.setTokens('expired-access', 'forbidden-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: response({}, { detail: 'denied' }, 403, JSON_HEADERS),
    });
    const expired = jest.fn();
    const unsubscribe = subscribeSessionExpired(expired);

    await expect(getAuthenticatedAccessToken({ forceRefresh: true })).rejects.toBeTruthy();

    expect(await tokenStore.getRefreshToken()).toBe('forbidden-refresh');
    expect(expired).not.toHaveBeenCalled();
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

describe('isDefinitiveAuthRejection', () => {
  it('treats JSON 401 from HUB-IT as a definitive rejection', () => {
    expect(isDefinitiveAuthRejection({
      response: { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } },
    })).toBe(true);
  });

  it.each([
    { status: 401, headers: {} },
    { status: 403, headers: { 'content-type': 'application/json' } },
    { status: 403, headers: { 'content-type': 'text/html' } },
    { status: 403, headers: undefined },
    { status: 429, headers: { 'content-type': 'application/json' } },
    { status: 503, headers: { 'content-type': 'application/json' } },
    { status: undefined, headers: undefined },
  ])('treats %j as transport, not a session answer', (response) => {
    expect(isDefinitiveAuthRejection({ response })).toBe(false);
    expect(isDefinitiveAuthRejection(new Error('Network Error'))).toBe(false);
  });
});

describe('isUserDeactivatedRejection', () => {
  it('treats a JSON 401 with the user_inactive reason as deactivation', () => {
    expect(isUserDeactivatedRejection({
      response: {
        status: 401,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-hubit-auth-reason': 'user_inactive',
        },
        data: { detail: 'User is not active' },
      },
    })).toBe(true);
  });

  it('accepts the legacy 400 «Inactive user» answer on /auth/me', () => {
    expect(isUserDeactivatedRejection({
      config: { url: '/auth/me' },
      response: {
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: { detail: 'Inactive user' },
      },
    })).toBe(true);
  });

  it('keeps an ordinary JSON 401 on the session-expired semantics', () => {
    const plain401 = {
      response: { status: 401, headers: { 'content-type': 'application/json' } },
    };
    expect(isUserDeactivatedRejection(plain401)).toBe(false);
    expect(isDefinitiveAuthRejection(plain401)).toBe(true);
  });

  it.each([
    { desc: '401 JSON with a different reason', error: {
      response: { status: 401, headers: {
        'content-type': 'application/json',
        'x-hubit-auth-reason': 'credentials_invalid',
      } },
    } },
    { desc: '401 HTML with the header (proxy page, not HUB-IT)', error: {
      response: { status: 401, headers: {
        'content-type': 'text/html',
        'x-hubit-auth-reason': 'user_inactive',
      } },
    } },
    { desc: '400 «Inactive user» on another endpoint', error: {
      config: { url: '/profile' },
      response: { status: 400, headers: { 'content-type': 'application/json' }, data: { detail: 'Inactive user' } },
    } },
    { desc: '400 «Inactive user» on /auth/me without JSON', error: {
      config: { url: '/auth/me' },
      response: { status: 400, headers: { 'content-type': 'text/html' }, data: { detail: 'Inactive user' } },
    } },
    { desc: '400 with a different detail on /auth/me', error: {
      config: { url: '/auth/me' },
      response: { status: 400, headers: { 'content-type': 'application/json' }, data: { detail: 'Validation failed' } },
    } },
    { desc: 'JSON 403', error: {
      response: { status: 403, headers: { 'content-type': 'application/json' } },
    } },
  ])('treats $desc as not a deactivation', ({ error }) => {
    expect(isUserDeactivatedRejection(error)).toBe(false);
    expect(isUserDeactivatedRejection(new Error('Network Error'))).toBe(false);
  });
});

describe('isNetworkRestrictedRejection', () => {
  it('treats JSON 403 from HUB-IT as a network restriction, not an expired session', () => {
    expect(isNetworkRestrictedRejection({
      response: {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        data: { detail: 'Admin access from this IP is not allowed' },
      },
    })).toBe(true);
  });

  it.each([
    { status: 403, headers: {} },
    { status: 403, headers: { 'content-type': 'text/html' } },
    { status: 401, headers: { 'content-type': 'application/json' } },
    { status: 429, headers: { 'content-type': 'application/json' } },
    { status: undefined, headers: undefined },
  ])('treats %j as not a HUB-IT network restriction', (response) => {
    expect(isNetworkRestrictedRejection({ response })).toBe(false);
    expect(isNetworkRestrictedRejection(new Error('Network Error'))).toBe(false);
  });
});

it.each(['success', 'unauthorized', 'network'] as const)('does not replace or expire a new login when old refresh finishes: %s', async (outcome) => {
  await tokenStore.setTokens('old-access', 'old-refresh');
  let finish!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  jest.spyOn(axios, 'post').mockImplementationOnce(() => new Promise((resolve, reject) => {
    finish = resolve; fail = reject; started();
  }) as never);
  const expired = jest.fn();
  const unsubscribe = subscribeSessionExpired(expired);
  try {
    const pending = getAuthenticatedAccessToken({ forceRefresh: true });
    const rejected = expect(pending).rejects.toThrow('Mobile session changed during refresh');
    await requested;
    await tokenStore.setTokens('new-login-access', 'new-login-refresh');
    if (outcome === 'success') finish(response({}, { access_token: 'stale-access', refresh_token: 'stale-refresh' }));
    else fail({ isAxiosError: true, response: outcome === 'unauthorized' ? response({}, {}, 401) : undefined });
    await rejected;
    expect(await tokenStore.getAccessToken()).toBe('new-login-access');
    expect(await tokenStore.getRefreshToken()).toBe('new-login-refresh');
    expect(expired).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
});

it('does not restore credentials after logout while refresh was in flight', async () => {
  await tokenStore.setTokens('old-access', 'old-refresh');
  let finish!: (value: unknown) => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  jest.spyOn(axios, 'post').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; started(); }) as never);
  const pending = getAuthenticatedAccessToken({ forceRefresh: true });
  const rejected = expect(pending).rejects.toThrow('Mobile session changed during refresh');
  await requested;
  await tokenStore.clearTokens();
  finish(response({}, { access_token: 'stale-access', refresh_token: 'stale-refresh' }));
  await rejected;
  expect(await tokenStore.getAccessToken()).toBeNull();
});

it('does not replay an old mutation under a newly signed-in account after a delayed 401', async () => {
  await tokenStore.setTokens('old-access', 'old-refresh');
  let rejectRequest!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  const adapter = jest.fn((config: InternalAxiosRequestConfig) => new Promise((_resolve, reject) => {
    rejectRequest = () => reject({ config, response: response(config, {}, 401), isAxiosError: true });
    started();
  }));
  apiClient.defaults.adapter = adapter as never;
  const refresh = jest.spyOn(axios, 'post');
  const pending = apiClient.post('/chat/conversations/old/messages', { body_text: 'Synthetic' });
  const rejected = expect(pending).rejects.toThrow('Mobile session changed during request');
  await requested;
  await tokenStore.setTokens('new-access', 'new-refresh');
  rejectRequest();
  await rejected;
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  expect(await tokenStore.getAccessToken()).toBe('new-access');
});

it('rejects an old successful response instead of exposing its data after account change', async () => {
  await tokenStore.setTokens('old-access', 'old-refresh');
  let finish!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => new Promise((resolve) => {
    finish = () => resolve(response(config, { private: 'synthetic-old-user-data' }));
    started();
  })) as never;
  const pending = apiClient.get('/mail/messages');
  const rejected = expect(pending).rejects.toThrow('Mobile session changed during request');
  await requested;
  await tokenStore.setTokens('new-access', 'new-refresh');
  finish();
  await rejected;
});

describe('in-flight request accounting', () => {
  beforeEach(() => resetApiInflight());

  it('counts concurrent requests and settles back to zero', async () => {
    await tokenStore.setTokens('access', 'refresh');
    const releases: Array<() => void> = [];
    let resolveBoth!: () => void;
    const both = new Promise<void>((resolve) => { resolveBoth = resolve; });
    apiClient.defaults.adapter = ((config: InternalAxiosRequestConfig) => new Promise((resolve) => {
      releases.push(() => resolve(response(config, { ok: true })));
      if (releases.length === 2) resolveBoth();
    })) as never;

    const first = apiClient.get('/inflight-one');
    const second = apiClient.get('/inflight-two');
    await both;
    expect(getApiInflightSummary().current).toBe(2);
    releases.forEach((release) => release());
    await Promise.all([first, second]);

    const summary = getApiInflightSummary();
    expect(summary.current).toBe(0);
    expect(summary.maxObserved).toBe(2);
    expect(summary.started).toBe(2);
    expect(summary.completed).toBe(2);
  });

  it('stays balanced through a 401 refresh retry', async () => {
    await tokenStore.setTokens('expired-access', 'refresh-token');
    jest.spyOn(axios, 'post').mockResolvedValue(response({}, {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }) as never);
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const authorization = String(config.headers?.Authorization || '');
      if (authorization === 'Bearer expired-access') return unauthorized(config);
      return response(config, { ok: true });
    }) as never;

    await apiClient.get('/protected');

    const summary = getApiInflightSummary();
    expect(summary.current).toBe(0);
    expect(summary.completed).toBe(summary.started);
    expect(summary.started).toBe(2);
  });

  it('does not count mutations blocked by the offline policy', async () => {
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => response(config, { ok: true })) as never;
    setNativeOfflineReadOnly(true);

    await expect(apiClient.post('/profile/avatar', { value: 'x' })).rejects.toMatchObject({
      code: 'HUBIT_OFFLINE_READ_ONLY',
    });
    expect(getApiInflightSummary().started).toBe(0);
    expect(getApiInflightSummary().current).toBe(0);
  });
});

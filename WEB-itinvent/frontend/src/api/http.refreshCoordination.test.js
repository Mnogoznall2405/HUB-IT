import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = {
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

class MockCanceledError extends Error {
  constructor(message) {
    super(message || 'Canceled');
    this.name = 'CanceledError';
    this.code = 'ERR_CANCELED';
  }
}

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => apiClientMock),
    CanceledError: MockCanceledError,
  },
}));

const EPOCH_KEY = 'hubit.auth.refresh_epoch';
const CLAIM_KEY = 'hubit.auth.refresh_claim';
const LOCK_NAME = 'hubit.auth.refresh';

const installLocks = () => {
  const request = vi.fn((name, callback) => Promise.resolve().then(callback));
  Object.defineProperty(window.navigator, 'locks', {
    value: { request },
    configurable: true,
  });
  return request;
};

const getRejectedHandler = () => (
  apiClientMock.interceptors.response.use.mock.calls.at(-1)?.[1]
);
const getFulfilledHandler = () => (
  apiClientMock.interceptors.response.use.mock.calls.at(-1)?.[0]
);

const unauthorizedError = (url = '/tasks') => ({
  response: { status: 401 },
  config: { url },
});

describe('apiClient cross-tab refresh coordination', () => {
  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    apiClientMock.get = vi.fn();
    apiClientMock.post = vi.fn();
    apiClientMock.request = vi.fn().mockResolvedValue({ data: { ok: true } });
    apiClientMock.interceptors.response.use.mockClear();
    installLocks();
    await import('./http');
  });

  afterEach(() => {
    delete window.navigator.locks;
    vi.useRealTimers();
  });

  it('serializes the rotation through the cross-tab lock and marks the epoch', async () => {
    apiClientMock.post.mockResolvedValue({ data: { session_id: 's-1' } });
    const locksRequest = window.navigator.locks.request;

    await getRejectedHandler()(unauthorizedError());

    expect(locksRequest).toHaveBeenCalledTimes(1);
    expect(locksRequest.mock.calls[0][0]).toBe(LOCK_NAME);
    expect(apiClientMock.post).toHaveBeenCalledTimes(1);
    expect(apiClientMock.post.mock.calls[0][0]).toBe('/auth/refresh');
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
    expect(Number(window.localStorage.getItem(EPOCH_KEY))).toBeGreaterThan(0);
  });

  it('skips the refresh POST when a sibling tab rotated recently', async () => {
    window.localStorage.setItem(EPOCH_KEY, String(Date.now()));

    await getRejectedHandler()(unauthorizedError());

    expect(apiClientMock.post).not.toHaveBeenCalled();
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
  });

  it('retries a transport-failed refresh exactly once', async () => {
    vi.useFakeTimers();
    const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    apiClientMock.post
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ data: { session_id: 's-2' } });

    const pending = getRejectedHandler()(unauthorizedError());
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    const refreshCalls = apiClientMock.post.mock.calls
      .filter(([url]) => url === '/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
  });

  it('skips the transport retry when a sibling rotated during the failure window', async () => {
    const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    apiClientMock.post.mockImplementation((url) => {
      if (url === '/auth/refresh') {
        window.localStorage.setItem(EPOCH_KEY, String(Date.now()));
        return Promise.reject(networkError);
      }
      return Promise.resolve({ data: {} });
    });

    await getRejectedHandler()(unauthorizedError());

    const refreshCalls = apiClientMock.post.mock.calls
      .filter(([url]) => url === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
  });

  it('does not retry a definitive refresh rejection and notifies auth-required', async () => {
    const onAuthRequired = vi.fn();
    window.addEventListener('auth-required', onAuthRequired);
    window.localStorage.setItem('user', JSON.stringify({ id: 1, username: 'user' }));
    apiClientMock.post.mockRejectedValue({
      response: { status: 401 },
      config: { url: '/auth/refresh', suppressAuthRequired: true },
    });

    const error = unauthorizedError();
    await expect(getRejectedHandler()(error)).rejects.toBe(error);

    const refreshCalls = apiClientMock.post.mock.calls
      .filter(([url]) => url === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(apiClientMock.request).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('user')).toBeNull();
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth-required', onAuthRequired);
  });

  it('marks the epoch on interactive login so queued 401 refreshes skip', async () => {
    const response = { config: { url: '/auth/login', method: 'post' }, status: 200, data: {} };
    await getFulfilledHandler()(response);
    expect(Number(window.localStorage.getItem(EPOCH_KEY))).toBeGreaterThan(0);
  });

  it('marks the epoch on passkey-login verify (session-issuing)', async () => {
    const response = { config: { url: '/auth/passkey-login/verify', method: 'post' }, status: 200, data: {} };
    await getFulfilledHandler()(response);
    expect(Number(window.localStorage.getItem(EPOCH_KEY))).toBeGreaterThan(0);
  });

  it('does not mark the epoch on public /auth/login-mode', async () => {
    const response = { config: { url: '/auth/login-mode', method: 'get' }, status: 200, data: {} };
    await getFulfilledHandler()(response);
    expect(window.localStorage.getItem(EPOCH_KEY)).toBeNull();
  });

  it('suppresses further replays for the grace window after two transport losses', async () => {
    vi.useFakeTimers();
    const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    apiClientMock.post.mockRejectedValue(networkError);

    const pending = getRejectedHandler()(unauthorizedError()).catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toBe(networkError);

    const refreshCalls = apiClientMock.post.mock.calls
      .filter(([url]) => url === '/auth/refresh');
    expect(refreshCalls).toHaveLength(2);
    // Poisoned-cookie suppression: epoch must look fresh for the whole grace
    // window (> REFRESH_RECENT_WINDOW_MS of 10s).
    const epoch = Number(window.localStorage.getItem(EPOCH_KEY));
    expect(epoch).toBeGreaterThan(Date.now() + 5_000);
    expect(apiClientMock.request).not.toHaveBeenCalled();
  });

  it('waits for a sibling claim on the lockless path, then refreshes', async () => {
    delete window.navigator.locks;
    vi.useFakeTimers();
    window.localStorage.setItem(CLAIM_KEY, String(Date.now()));
    apiClientMock.post.mockResolvedValue({ data: { session_id: 's-3' } });

    const pending = getRejectedHandler()(unauthorizedError());
    // Claim stays fresh until ~10s; the waiter must not POST before it stales.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(apiClientMock.post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;

    const refreshCalls = apiClientMock.post.mock.calls
      .filter(([url]) => url === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(CLAIM_KEY)).toBeNull();
  });

  it('skips when a waiting sibling sees the claim replaced by a fresh epoch', async () => {
    delete window.navigator.locks;
    vi.useFakeTimers();
    window.localStorage.setItem(CLAIM_KEY, String(Date.now()));
    apiClientMock.post.mockResolvedValue({ data: {} });

    const pending = getRejectedHandler()(unauthorizedError());
    // Sibling finishes during our wait: claim cleared, epoch marked.
    await vi.advanceTimersByTimeAsync(200);
    window.localStorage.removeItem(CLAIM_KEY);
    window.localStorage.setItem(EPOCH_KEY, String(Date.now()));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(apiClientMock.post).not.toHaveBeenCalled();
    expect(apiClientMock.request).toHaveBeenCalledTimes(1);
  });
});

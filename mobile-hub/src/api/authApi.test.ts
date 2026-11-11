import type { InternalAxiosRequestConfig } from 'axios';
import apiClient from './client';
import { fetchMe } from './authApi';
import * as tokenStore from '../auth/tokenStore';

const originalAdapter = apiClient.defaults.adapter;

function respond(data: unknown, status = 200) {
  apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => ({
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
  })) as never;
}

const validUser = {
  id: 7,
  username: 'mobile-test',
  role: 'viewer',
  permissions: ['dashboard.read'],
};

afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
  jest.restoreAllMocks();
});

describe('fetchMe session response validation', () => {
  it('treats a 200 HTML answer from a captive portal as a transport failure', async () => {
    await tokenStore.setTokens('access', 'refresh');
    respond('<html><body>Wi-Fi sign-in</body></html>');

    await expect(fetchMe()).rejects.toThrow('некорректный профиль');
  });

  it.each([
    { id: 'seven', username: 'mobile-test', role: 'viewer', permissions: [] },
    { id: 7, username: '', role: 'viewer', permissions: [] },
    { id: 7, username: 'mobile-test', role: 'viewer', permissions: 'none' },
    'OK',
    null,
  ])('rejects a malformed profile payload %j', async (payload) => {
    await tokenStore.setTokens('access', 'refresh');
    respond(payload);

    await expect(fetchMe()).rejects.toThrow('некорректный профиль');
  });

  it('returns the profile when the payload matches the session contract', async () => {
    await tokenStore.setTokens('access', 'refresh');
    respond(validUser);

    await expect(fetchMe()).resolves.toEqual(validUser);
  });

  it('bounds the request by the provided total timeout', async () => {
    await tokenStore.setTokens('access', 'refresh');
    let seenTimeout = 0;
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      seenTimeout = Number(config.timeout || 0);
      return { data: validUser, status: 200, statusText: 'OK', headers: {}, config };
    }) as never;

    await fetchMe({ timeoutMs: 3_000 });

    // The per-request timeout is the remainder of the total budget, so it can
    // arrive a few milliseconds below the requested ceiling.
    expect(seenTimeout).toBeGreaterThan(2_000);
    expect(seenTimeout).toBeLessThanOrEqual(3_000);
  });
});

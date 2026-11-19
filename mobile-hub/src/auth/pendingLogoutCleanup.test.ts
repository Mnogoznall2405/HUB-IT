import axios from 'axios';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  clearPendingLogoutCleanup,
  forgetPendingLogoutCleanup,
  rememberPendingLogoutCleanup,
  runPendingLogoutCleanup,
} from './pendingLogoutCleanup';

jest.mock('axios', () => ({
  post: jest.fn(async () => ({ data: {} })),
  isAxiosError: (error: unknown) => Boolean(error && (error as { isAxiosError?: boolean }).isAxiosError),
}));

jest.mock('expo-crypto', () => {
  const actual = jest.requireActual('expo-crypto');
  const { createHash } = require('crypto');
  return {
    ...actual,
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex')),
  };
});

jest.mock('../api/config', () => ({
  API_V1_BASE: 'https://hubit.test/api/v1',
}));

jest.mock('../api/client', () => ({
  withMobileAuthHeaders: (clientDeviceId?: string | null) => ({
    'X-HubIT-Mobile': 'android',
    ...(clientDeviceId ? { 'X-Client-Device-Id': clientDeviceId } : {}),
  }),
}));

const INDEX_KEY = 'hubit_pending_logout_cleanup_index_v2';
const ENTRY_PREFIX = 'hubit_pending_logout_cleanup_entry_v2_';
const LEGACY_KEY = 'hubit_pending_logout_cleanup_v1';

const mockedAxios = axios as jest.Mocked<typeof axios>;

async function digest(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

async function storedIds(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function remember(refreshToken: string, clientDeviceId = `device-${refreshToken}`) {
  return rememberPendingLogoutCleanup({ refreshToken, clientDeviceId, pushToken: `push-${refreshToken}` });
}

describe('pendingLogoutCleanup queue', () => {
  beforeEach(() => {
    mockedAxios.post.mockResolvedValue({ data: {} });
  });

  afterEach(async () => {
    await clearPendingLogoutCleanup();
  });

  it('indexes records by token digest and never stores tokens in keys', async () => {
    await remember('refresh-A', 'device-A');
    await remember('refresh-B', 'device-B');

    const ids = await storedIds();
    expect(ids).toEqual([await digest('refresh-A'), await digest('refresh-B')]);
    const indexRaw = String(await SecureStore.getItemAsync(INDEX_KEY) || '');
    expect(indexRaw).not.toContain('refresh-A');
    expect(indexRaw).not.toContain('refresh-B');
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{64}$/);

    const stored = JSON.parse(String(await SecureStore.getItemAsync(`${ENTRY_PREFIX}${ids[0]}`)));
    expect(stored).toMatchObject({
      refreshToken: 'refresh-A',
      clientDeviceId: 'device-A',
      pushToken: 'push-refresh-A',
    });
    expect(Number.isFinite(stored.createdAt)).toBe(true);
  });

  it('keeps every record when the network is down, then replays each without auth headers', async () => {
    await remember('refresh-A', 'device-A');
    await remember('refresh-B', 'device-B');
    mockedAxios.post.mockRejectedValue({ isAxiosError: true });

    await runPendingLogoutCleanup();
    // A network failure stops the pass after the first record; nothing is dropped.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(await storedIds()).toHaveLength(2);

    mockedAxios.post.mockClear();
    mockedAxios.post.mockResolvedValue({ data: {} });
    await runPendingLogoutCleanup();

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockedAxios.post.mock.calls;
    expect(firstCall[0]).toBe('https://hubit.test/api/v1/auth/logout');
    expect(firstCall[1]).toEqual({ refresh_token: 'refresh-A' });
    expect(firstCall[2]?.headers).toMatchObject({ 'X-Client-Device-Id': 'device-A' });
    expect(firstCall[2]?.headers?.Authorization).toBeUndefined();
    expect(secondCall[1]).toEqual({ refresh_token: 'refresh-B' });
    expect(secondCall[2]?.headers?.Authorization).toBeUndefined();
    expect(await storedIds()).toEqual([]);
  });

  it('drops only the successfully replayed record when another gets an HTTP error', async () => {
    await remember('refresh-A', 'device-A');
    await remember('refresh-B', 'device-B');
    mockedAxios.post
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } })
      .mockResolvedValue({ data: {} });

    await runPendingLogoutCleanup();
    // A's HTTP error must not block B: both were attempted, only A remains.
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(await storedIds()).toEqual([await digest('refresh-A')]);

    mockedAxios.post.mockClear();
    await runPendingLogoutCleanup();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ refresh_token: 'refresh-A' });
    expect(await storedIds()).toEqual([]);
  });

  it('migrates the legacy single-record format and replays it once', async () => {
    await SecureStore.setItemAsync(LEGACY_KEY, JSON.stringify({
      refreshToken: 'refresh-legacy',
      clientDeviceId: 'device-legacy',
      pushToken: null,
      createdAt: 123,
    }));

    await runPendingLogoutCleanup();

    expect(await SecureStore.getItemAsync(LEGACY_KEY)).toBeNull();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://hubit.test/api/v1/auth/logout',
      { refresh_token: 'refresh-legacy' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Client-Device-Id': 'device-legacy' }),
      }),
    );
    expect(await storedIds()).toEqual([]);
  });

  it('forgets only the matching record when a logout succeeds server-side', async () => {
    await remember('refresh-A', 'device-A');
    await remember('refresh-B', 'device-B');

    await forgetPendingLogoutCleanup('refresh-A');
    expect(await storedIds()).toEqual([await digest('refresh-B')]);

    await runPendingLogoutCleanup();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ refresh_token: 'refresh-B' });
    expect(await storedIds()).toEqual([]);
  });

  it('deduplicates repeated remembers of the same refresh token', async () => {
    await remember('refresh-A', 'device-A');
    await remember('refresh-A', 'device-A');

    expect(await storedIds()).toEqual([await digest('refresh-A')]);
    await runPendingLogoutCleanup();
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});

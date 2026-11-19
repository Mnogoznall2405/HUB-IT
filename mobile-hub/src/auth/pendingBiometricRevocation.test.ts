import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  clearPendingBiometricRevocation,
  rememberPendingBiometricRevocation,
  runPendingBiometricRevocation,
} from './pendingBiometricRevocation';
import * as tokenStore from './tokenStore';

jest.mock('axios', () => ({
  delete: jest.fn(async () => ({ data: {} })),
  isAxiosError: (error: unknown) => Boolean(error && (error as { isAxiosError?: boolean }).isAxiosError),
}));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { store.delete(key); }),
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

jest.mock('./tokenStore', () => ({
  getAccessToken: jest.fn(async () => 'access-token'),
}));

const STORAGE_KEY = 'hubit_pending_biometric_revocation_v1';
const mockedAxios = axios as jest.Mocked<typeof axios>;

function httpError(status: number) {
  return { isAxiosError: true, response: { status } };
}

async function storedRecord() {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('runPendingBiometricRevocation', () => {
  beforeEach(async () => {
    await clearPendingBiometricRevocation();
    await rememberPendingBiometricRevocation(7, 'device-A');
    jest.clearAllMocks();
  });

  it.each([500, 429])('keeps the record for a retry on a transient server answer (%i)', async (status) => {
    mockedAxios.delete.mockRejectedValueOnce(httpError(status));

    await runPendingBiometricRevocation(7);

    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/auth/mobile-biometric'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) }),
    );
    // A 5xx/rate-limit answer does not prove the credential is gone — replay later.
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(await storedRecord()).toMatchObject({ userId: 7, clientDeviceId: 'device-A' });
  });

  it('drops the record once the server definitively says the credential is gone (404)', async () => {
    mockedAxios.delete.mockRejectedValueOnce(httpError(404));

    await runPendingBiometricRevocation(7);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(STORAGE_KEY);
    expect(await storedRecord()).toBeNull();
  });

  it('never revokes under a different signed-in user', async () => {
    await runPendingBiometricRevocation(8);

    expect(mockedAxios.delete).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(await storedRecord()).toMatchObject({ userId: 7 });
  });
});

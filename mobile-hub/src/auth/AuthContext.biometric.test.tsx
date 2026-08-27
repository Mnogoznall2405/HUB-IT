import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import * as authApi from '../api/authApi';
import * as biometricAuth from './biometricAuth';
import * as tokenStore from './tokenStore';
import { AuthProvider, useAuth } from './AuthContext';

let connectivityListener: ((snapshot: {
  available: boolean;
  online: boolean;
  connected: boolean;
  transport: 'none' | 'wifi';
  metered: boolean;
  changedAtMs: number;
}) => void) | null = null;

jest.mock('../network/nativeConnectivity', () => ({
  getNativeConnectivitySnapshot: jest.fn(async () => ({
    available: false,
    online: false,
    connected: false,
    transport: 'none',
    metered: false,
    changedAtMs: 0,
  })),
  subscribeNativeConnectivity: jest.fn((listener) => {
    connectivityListener = listener;
    return { remove: jest.fn() };
  }),
}));

jest.mock('../api/authApi', () => ({
  fetchMe: jest.fn(),
  login: jest.fn(),
  startTwoFactorSetup: jest.fn(),
  verifyTwoFactorSetup: jest.fn(),
  verifyTwoFactorLogin: jest.fn(),
  renewMobileBiometricSession: jest.fn(),
  enrollMobileBiometricSession: jest.fn(),
  revokeMobileBiometricSession: jest.fn(async () => undefined),
}));

jest.mock('./tokenStore', () => ({
  hasSession: jest.fn(async () => true),
  getCachedSessionUser: jest.fn(async () => null),
  setCachedSessionUser: jest.fn(async () => undefined),
  setSessionUserId: jest.fn(async () => undefined),
  setTokens: jest.fn(async () => undefined),
  setClientDeviceId: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('./biometricAuth', () => ({
  isBiometricLoginEnabled: jest.fn(async () => true),
  getBiometricLoginUserId: jest.fn(async () => 7),
  unlockBiometricLogin: jest.fn(),
  disableBiometricLogin: jest.fn(async () => undefined),
  enableBiometricLogin: jest.fn(),
}));

jest.mock('../chat/chatSocket', () => ({
  chatSocket: { disconnect: jest.fn() },
}));

jest.mock('./logout', () => ({
  endMobileSession: jest.fn(async () => undefined),
}));

jest.mock('./sessionEvents', () => ({
  subscribeSessionExpired: jest.fn(() => () => undefined),
}));

const cachedUser = {
  id: 7,
  username: 'mobile-test',
  role: 'viewer',
  permissions: ['dashboard.read'],
};

let currentAuth: ReturnType<typeof useAuth> | null = null;

function Probe() {
  currentAuth = useAuth();
  return (
    <>
      <Text>{currentAuth.loading ? 'loading' : currentAuth.user?.username || 'locked'}</Text>
      <Text testID="offline-mode">{currentAuth.offlineMode ? 'offline' : 'online'}</Text>
    </>
  );
}

describe('AuthProvider biometric unlock', () => {
  beforeEach(() => {
    currentAuth = null;
    connectivityListener = null;
    jest.mocked(tokenStore.hasSession).mockResolvedValue(false);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValue(null);
    jest.mocked(biometricAuth.isBiometricLoginEnabled).mockResolvedValue(true);
    jest.mocked(authApi.fetchMe).mockReset();
    jest.mocked(biometricAuth.unlockBiometricLogin).mockResolvedValue({
      version: 2,
      user: cachedUser,
      offlineCacheKey: 'a'.repeat(64),
      renewalToken: `mb1.${'1'.repeat(32)}.${'b'.repeat(48)}`,
      createdAt: '2026-08-22T00:00:00.000Z',
    });
  });

  it('does not expose a cached identity before the network session check completes', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    let resolveFetch: ((user: typeof cachedUser) => void) | undefined;
    jest.mocked(authApi.fetchMe).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    expect(view.getByText('loading')).toBeTruthy();
    expect(view.queryByText('mobile-test')).toBeNull();
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    await act(async () => resolveFetch?.(cachedUser));
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
  });

  it('restores a live JWT session without asking for a fingerprint', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(currentAuth?.biometricEnabled).toBe(true);
    expect(authApi.fetchMe).toHaveBeenCalled();
    expect(biometricAuth.unlockBiometricLogin).not.toHaveBeenCalled();
  });

  it('unlocks only the protected offline cache key for an already restored user', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());

    let cacheKey: string | undefined;
    await act(async () => {
      cacheKey = await currentAuth?.unlockOfflineCache();
    });

    expect(cacheKey).toBe('a'.repeat(64));
    expect(currentAuth?.offlineCacheKey).toBe('a'.repeat(64));
    expect(biometricAuth.unlockBiometricLogin).toHaveBeenCalledTimes(1);
    expect(authApi.renewMobileBiometricSession).not.toHaveBeenCalled();
  });

  it('retries a live JWT session after a transient startup network failure', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(authApi.fetchMe)
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), {
        isAxiosError: true,
        code: 'ERR_NETWORK',
        response: undefined,
      }))
      .mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
    expect(biometricAuth.unlockBiometricLogin).not.toHaveBeenCalled();
  });

  it('does not double the startup wait after the auth request already timed out', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockRejectedValue(Object.assign(new Error('timeout of 5000ms exceeded'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
      response: undefined,
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
  });

  it('keeps the login gate locked until biometric unlock when startup transport retries are exhausted', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockRejectedValue(Object.assign(new Error('Network Error'), {
      isAxiosError: true,
      code: 'ERR_NETWORK',
      response: undefined,
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    await waitFor(() => expect(view.getByTestId('offline-mode').props.children).toBe('offline'));
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
  });

  it('updates native offline mode immediately when Android connectivity changes', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(connectivityListener).not.toBeNull();

    await act(async () => connectivityListener?.({
      available: true,
      online: false,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 1,
    }));
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');

    await act(async () => connectivityListener?.({
      available: true,
      online: true,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 2,
    }));
    expect(view.getByTestId('offline-mode').props.children).toBe('online');
  });

  it('rejects a cached identity when the server definitively rejects the session', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(tokenStore.clearTokens).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('offline-mode').props.children).toBe('online');
  });

  it('keeps the login gate locked when biometrics are on but tokens are missing', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(false);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(currentAuth?.biometricEnabled).toBe(true);
    expect(authApi.fetchMe).not.toHaveBeenCalled();
    expect(biometricAuth.unlockBiometricLogin).not.toHaveBeenCalled();
  });

  it('preserves an enrolled biometric credential after password login for the same user', async () => {
    jest.mocked(authApi.login).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      user: cachedUser,
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    await act(async () => {
      await currentAuth?.login('mobile-test', 'password');
    });

    expect(biometricAuth.disableBiometricLogin).not.toHaveBeenCalled();
    expect(currentAuth?.biometricEnabled).toBe(true);
    expect(view.getByText('mobile-test')).toBeTruthy();
  });

  it('removes an enrolled biometric credential after password login as another user', async () => {
    jest.mocked(authApi.login).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'other-access',
      refresh_token: 'other-refresh',
      user: { ...cachedUser, id: 8, username: 'other-user' },
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    await act(async () => {
      await currentAuth?.login('other-user', 'password');
    });

    expect(biometricAuth.disableBiometricLogin).toHaveBeenCalledTimes(1);
    expect(currentAuth?.biometricEnabled).toBe(false);
    expect(view.getByText('other-user')).toBeTruthy();
  });

  it('exposes enrollment readiness only until the fresh 2FA code is consumed', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(biometricAuth.isBiometricLoginEnabled).mockResolvedValueOnce(false);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.login).mockResolvedValueOnce({
      status: '2fa_required',
      login_challenge_id: 'challenge-1',
    });
    jest.mocked(authApi.verifyTwoFactorLogin).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      user: cachedUser,
      biometric_enrollment_code: 'e'.repeat(48),
    });
    jest.mocked(authApi.enrollMobileBiometricSession).mockResolvedValueOnce(
      `mb1.${'1'.repeat(32)}.${'b'.repeat(48)}`,
    );
    jest.mocked(biometricAuth.enableBiometricLogin).mockResolvedValueOnce({
      version: 2,
      user: cachedUser,
      offlineCacheKey: 'a'.repeat(64),
      renewalToken: `mb1.${'1'.repeat(32)}.${'b'.repeat(48)}`,
      createdAt: '2026-08-24T00:00:00.000Z',
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(currentAuth?.biometricEnrollmentAvailable).toBe(false);

    await act(async () => {
      await currentAuth?.login('mobile-test', 'password');
    });
    await act(async () => {
      await currentAuth?.verifyTwoFactor('123456');
    });
    expect(currentAuth?.biometricEnrollmentAvailable).toBe(true);

    await act(async () => {
      await currentAuth?.enableBiometrics();
    });
    expect(currentAuth?.biometricEnrollmentAvailable).toBe(false);
    expect(currentAuth?.biometricEnabled).toBe(true);
  });

  it('keeps the real setup challenge and completes native TOTP enrollment', async () => {
    jest.mocked(authApi.login).mockResolvedValueOnce({
      status: '2fa_setup_required',
      login_challenge_id: 'setup-challenge-123',
    });
    jest.mocked(authApi.startTwoFactorSetup).mockResolvedValueOnce({
      login_challenge_id: 'setup-challenge-123',
      otpauth_uri: 'otpauth://totp/HUB-IT:mobile-test?secret=SECRET123',
      issuer: 'HUB-IT',
      account_name: 'mobile-test',
      manual_entry_key: 'SECRET123',
    });
    jest.mocked(authApi.verifyTwoFactorSetup).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'setup-access',
      refresh_token: 'setup-refresh',
      user: cachedUser,
      biometric_enrollment_code: 'e'.repeat(48),
      backup_codes: ['BACKUP-ONE'],
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    await act(async () => { await currentAuth?.login('mobile-test', 'password'); });
    expect(currentAuth?.loginChallengeId).toBe('setup');
    await act(async () => { await currentAuth?.startTwoFactorSetup(); });
    expect(authApi.startTwoFactorSetup).toHaveBeenCalledWith('setup-challenge-123');
    let backupCodes: string[] | undefined;
    await act(async () => { backupCodes = await currentAuth?.verifyTwoFactorSetup('123456'); });
    expect(authApi.verifyTwoFactorSetup).toHaveBeenCalledWith('setup-challenge-123', '123456');
    expect(backupCodes).toEqual(['BACKUP-ONE']);
    expect(currentAuth?.loginChallengeId).toBeNull();
    expect(view.getByText('mobile-test')).toBeTruthy();
  });

  it('renews an expired APK session after the fingerprint is accepted', async () => {
    jest.mocked(authApi.renewMobileBiometricSession).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      user: cachedUser,
      client_device_id: 'mobile-api-device-1234567890',
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    let result;
    await act(async () => {
      result = await currentAuth?.unlockWithBiometrics();
    });

    expect(result).toEqual({ user: cachedUser, offline: false });
    expect(tokenStore.setTokens).toHaveBeenCalledWith('new-access', 'new-refresh');
    expect(view.getByText('mobile-test')).toBeTruthy();
  });

  it('opens the protected local snapshot when the server is unreachable', async () => {
    jest.mocked(authApi.renewMobileBiometricSession).mockRejectedValueOnce(new Error('Network Error'));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    let result;
    await act(async () => {
      result = await currentAuth?.unlockWithBiometrics();
    });

    expect(result).toEqual({ user: cachedUser, offline: true });
    expect(currentAuth?.offlineMode).toBe(true);
    expect(currentAuth?.offlineCacheKey).toBe('a'.repeat(64));
    expect(view.getByText('mobile-test')).toBeTruthy();
  });

  it('removes local biometric access after a definitive server rejection', async () => {
    jest.mocked(authApi.renewMobileBiometricSession).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
    }));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    let failure: unknown;
    await act(async () => {
      try {
        await currentAuth?.unlockWithBiometrics();
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toEqual(expect.objectContaining({ message: expect.stringContaining('Сессия завершена') }));
    expect(currentAuth?.biometricEnabled).toBe(false);
  });
});

import { endMobileSession } from './logout';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';
import * as authApi from '../api/authApi';
import * as nativeConnectivity from '../network/nativeConnectivity';
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
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue({
      available: false,
      online: false,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 0,
    });
    jest.mocked(authApi.fetchMe).mockReset();
    jest.mocked(biometricAuth.unlockBiometricLogin).mockResolvedValue({
      version: 2,
      user: cachedUser,
      offlineCacheKey: 'a'.repeat(64),
      renewalToken: `mb1.${'1'.repeat(32)}.${'b'.repeat(48)}`,
      createdAt: '2026-08-22T00:00:00.000Z',
    });
  });

  it('keeps credentials after a temporary restore failure and retries explicitly', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(authApi.fetchMe).mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(currentAuth?.sessionRestoreState).toBe('unavailable'));
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);
    await act(async () => { currentAuth!.retrySessionRestore(); currentAuth!.retrySessionRestore(); });
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
    expect(currentAuth?.sessionRestoreState).toBe('idle');
  });

  it('distinguishes a definitive expired session from temporary failure', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(authApi.fetchMe).mockRejectedValueOnce({ response: { status: 401 } });
    await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(currentAuth?.sessionRestoreState).toBe('expired'));
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: false });
    expect(currentAuth?.user).toBeNull();
  });

  it('does not restore a profile from a refresh response arriving after logout', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    let resolve!: (value: typeof cachedUser) => void;
    jest.mocked(authApi.fetchMe).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    let pending!: Promise<void>;
    await act(async () => { pending = currentAuth!.refreshUser(); });
    await act(async () => { await currentAuth!.logout(); });
    await act(async () => { resolve(cachedUser); await pending; });
    expect(currentAuth?.user).toBeNull();
    expect(tokenStore.setCachedSessionUser).not.toHaveBeenCalled();
  });

  it('rejects an older login result after a newer login has completed', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    let finish!: (value: Awaited<ReturnType<typeof authApi.login>>) => void;
    jest.mocked(authApi.login).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let old!: Promise<unknown>;
    await act(async () => { old = currentAuth!.login('old', 'synthetic'); });
    const rejected = expect(old).rejects.toThrow('Попытка входа отменена');
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: 'authenticated', user: { ...cachedUser, id: 8, username: 'new' }, access_token: 'new', refresh_token: 'new-refresh' });
    await act(async () => { await currentAuth!.login('new', 'synthetic'); });
    await act(async () => {
      finish({ status: 'authenticated', user: cachedUser, access_token: 'old', refresh_token: 'old-refresh' });
      await rejected;
    });
    expect(currentAuth?.user?.id).toBe(8);
    expect(tokenStore.setTokens).toHaveBeenCalledTimes(1);
  });

  it('does not start login while logout cleanup is pending', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    let finish!: () => void;
    jest.mocked(endMobileSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = currentAuth!.logout(); });
    await expect(currentAuth!.login('new', 'synthetic')).rejects.toThrow('Выход ещё выполняется');
    expect(authApi.login).not.toHaveBeenCalled();
    await act(async () => { finish(); await pending; });
  });

  it('does not unlock offline from a late biometric credential after logout', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    let finish!: (value: Awaited<ReturnType<typeof biometricAuth.unlockBiometricLogin>>) => void;
    jest.mocked(biometricAuth.unlockBiometricLogin).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<unknown>;
    await act(async () => { pending = currentAuth!.unlockWithBiometrics(); });
    const rejected = expect(pending).rejects.toThrow('Попытка входа отменена');
    await act(async () => { await currentAuth!.logout(); });
    await act(async () => {
      finish({ version: 2, user: cachedUser, offlineCacheKey: 'synthetic', renewalToken: 'synthetic', createdAt: '2026-09-06' });
      await rejected;
    });
    expect(currentAuth?.user).toBeNull();
    expect(currentAuth?.offlineCacheKey).toBeNull();
    expect(authApi.renewMobileBiometricSession).not.toHaveBeenCalled();
  });

  it.each(['totp', 'backup', 'setup'] as const)('rejects a late %s result after a new login', async (mode) => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: mode === 'setup' ? '2fa_setup_required' : '2fa_required', login_challenge_id: 'old-challenge' });
    await act(async () => { await currentAuth!.login('old', 'synthetic'); });
    let finish!: (value: Awaited<ReturnType<typeof authApi.verifyTwoFactorSetup>>) => void;
    const response = new Promise<Awaited<ReturnType<typeof authApi.verifyTwoFactorSetup>>>((resolve) => { finish = resolve; });
    if (mode === 'setup') jest.mocked(authApi.verifyTwoFactorSetup).mockReturnValueOnce(response);
    else jest.mocked(authApi.verifyTwoFactorLogin).mockReturnValueOnce(response);
    let pending!: Promise<unknown>;
    await act(async () => { pending = mode === 'setup' ? currentAuth!.verifyTwoFactorSetup('123456') : currentAuth!.verifyTwoFactor('123456', mode === 'backup'); });
    const rejected = expect(pending).rejects.toThrow('Попытка входа отменена');
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: 'authenticated', user: { ...cachedUser, id: 8 }, access_token: 'new-access', refresh_token: 'new-refresh' });
    await act(async () => { await currentAuth!.login('new', 'synthetic'); });
    await act(async () => {
      finish({ status: 'authenticated', user: cachedUser, access_token: 'old-access', refresh_token: 'old-refresh', backup_codes: ['synthetic-backup'] });
      await rejected;
    });
    expect(currentAuth?.user?.id).toBe(8);
    expect(currentAuth?.loginChallengeId).toBeNull();
    expect(currentAuth?.biometricEnrollmentAvailable).toBe(false);
    expect(tokenStore.setTokens).toHaveBeenCalledTimes(1);
  });

  it('rejects old setup details after logout instead of returning the enrollment secret', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: '2fa_setup_required', login_challenge_id: 'old-challenge' });
    await act(async () => { await currentAuth!.login('old', 'synthetic'); });
    let finish!: (value: Awaited<ReturnType<typeof authApi.startTwoFactorSetup>>) => void;
    jest.mocked(authApi.startTwoFactorSetup).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<unknown>;
    await act(async () => { pending = currentAuth!.startTwoFactorSetup(); });
    const rejected = expect(pending).rejects.toThrow('Запрос настройки 2FA истёк');
    await act(async () => { await currentAuth!.logout(); });
    await act(async () => {
      finish({ login_challenge_id: 'old-challenge', otpauth_uri: 'synthetic', issuer: 'synthetic', account_name: 'synthetic', manual_entry_key: 'synthetic' });
      await rejected;
    });
    expect(currentAuth?.user).toBeNull();
  });

  it('does not expose an offline key when fingerprint completes after logout', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(authApi.fetchMe).mockResolvedValue(cachedUser);
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    let finish!: (value: Awaited<ReturnType<typeof biometricAuth.unlockBiometricLogin>>) => void;
    jest.mocked(biometricAuth.unlockBiometricLogin).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<string>;
    await act(async () => { pending = currentAuth!.unlockOfflineCache(); });
    const rejected = expect(pending).rejects.toThrow('Сессия изменилась');
    await act(async () => { await currentAuth!.logout(); });
    await act(async () => {
      finish({ version: 2, user: cachedUser, offlineCacheKey: 'synthetic', renewalToken: 'synthetic', createdAt: '2026-09-06' });
      await rejected;
    });
    expect(currentAuth?.offlineCacheKey).toBeNull();
  });

  it('does not disable the current biometric login after a late skip response', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    let finish!: () => void;
    jest.mocked(authApi.revokeMobileBiometricSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = currentAuth!.skipBiometrics(); });
    const rejected = expect(pending).rejects.toThrow('Сессия изменилась');
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: 'authenticated', user: cachedUser, access_token: 'new', refresh_token: 'new-refresh' });
    await act(async () => { await currentAuth!.login('new', 'synthetic'); });
    await act(async () => { finish(); await rejected; });
    expect(biometricAuth.disableBiometricLogin).not.toHaveBeenCalled();
    expect(currentAuth?.biometricEnabled).toBe(true);
  });

  it('does not persist a biometric credential from enrollment completed after logout', async () => {
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    jest.mocked(authApi.login).mockResolvedValueOnce({ status: '2fa_required', login_challenge_id: 'challenge' });
    await act(async () => { await currentAuth!.login('old', 'synthetic'); });
    jest.mocked(authApi.verifyTwoFactorLogin).mockResolvedValueOnce({ status: 'authenticated', user: cachedUser, access_token: 'access', refresh_token: 'refresh', biometric_enrollment_code: 'synthetic' });
    await act(async () => { await currentAuth!.verifyTwoFactor('123456'); });
    let finish!: (value: string) => void;
    jest.mocked(authApi.enrollMobileBiometricSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = currentAuth!.enableBiometrics(); });
    const rejected = expect(pending).rejects.toThrow('Сессия изменилась');
    await act(async () => { await currentAuth!.logout(); });
    await act(async () => { finish('synthetic-renewal'); await rejected; });
    expect(biometricAuth.enableBiometricLogin).not.toHaveBeenCalled();
    expect(currentAuth?.offlineCacheKey).toBeNull();
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

  it.each(['success', 'unauthorized'] as const)('ignores an older background restore during manual login: %s', async (outcome) => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue({ available: true, connected: true, online: true, transport: 'wifi', metered: false, changedAtMs: 1 });
    let finishRestore!: (value: typeof cachedUser) => void;
    let failRestore!: (cause: unknown) => void;
    jest.mocked(authApi.fetchMe).mockRejectedValueOnce(Object.assign(new Error('Synthetic timeout'), { code: 'ETIMEDOUT' }))
      .mockImplementationOnce(() => new Promise((resolve, reject) => { finishRestore = resolve; failRestore = reject; }));
    let finishLogin!: (value: Awaited<ReturnType<typeof authApi.login>>) => void;
    jest.mocked(authApi.login).mockImplementationOnce(() => new Promise((resolve) => { finishLogin = resolve; }));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(authApi.fetchMe).toHaveBeenCalledTimes(2));
    let pending!: Promise<unknown>;
    await act(async () => { pending = currentAuth!.login('new-user', 'synthetic-password'); });
    await act(async () => {
      if (outcome === 'success') finishRestore(cachedUser);
      else failRestore({ response: { status: 401 } });
    });
    expect(currentAuth!.user).toBeNull();
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
    await act(async () => {
      finishLogin({ status: 'authenticated', user: { ...cachedUser, id: 8, username: 'new-user' }, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
      await pending;
    });
    expect(view.getByText('new-user')).toBeTruthy();
  });

  it('does not keep the startup loader waiting for a best-effort cached identity refresh', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);
    let resolveCacheWrite: (() => void) | undefined;
    jest.mocked(tokenStore.setCachedSessionUser).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveCacheWrite = resolve;
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(resolveCacheWrite).toBeDefined();
    await act(async () => resolveCacheWrite?.());
  });

  it('skips the startup API timeout when Android already reports no network', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue({
      available: true,
      online: false,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 10,
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(authApi.fetchMe).not.toHaveBeenCalled();
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
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(authApi.fetchMe)
      .mockImplementationOnce(async () => {
        now = 4_500;
        throw Object.assign(new Error('Network Error'), {
          isAxiosError: true,
          code: 'ERR_NETWORK',
          response: undefined,
        });
      })
      .mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
    expect(authApi.fetchMe).toHaveBeenNthCalledWith(1, { timeoutMs: 5_000 });
    expect(authApi.fetchMe).toHaveBeenNthCalledWith(2, { timeoutMs: 1_500 });
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

  it('keeps the session online when HUB responds over an Android network that is not validated', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue({
      available: true,
      online: false,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 10,
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('offline-mode').props.children).toBe('online');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
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

  it('does not override a recent successful HUB response with a stale Android offline event', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValueOnce(true);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValueOnce(cachedUser);
    jest.mocked(authApi.fetchMe).mockResolvedValueOnce(cachedUser);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    expect(connectivityListener).not.toBeNull();

    await act(async () => connectivityListener?.({
      available: true,
      online: false,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 1,
    }));
    expect(view.getByTestId('offline-mode').props.children).toBe('online');

    await act(async () => connectivityListener?.({
      available: true,
      online: false,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 2,
    }));
    expect(view.getByTestId('offline-mode').props.children).toBe('online');

    const afterGrace = Date.now() + 31_000;
    jest.spyOn(Date, 'now').mockReturnValue(afterGrace);
    await act(async () => connectivityListener?.({
      available: true,
      online: false,
      connected: false,
      transport: 'none',
      metered: false,
      changedAtMs: 3,
    }));
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');

    await act(async () => connectivityListener?.({
      available: true,
      online: true,
      connected: true,
      transport: 'wifi',
      metered: false,
      changedAtMs: 4,
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
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: false });
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

  it('starts password authentication without waiting for the local biometric lookup', async () => {
    let resolveBiometricUser: ((userId: number | null) => void) | undefined;
    jest.mocked(biometricAuth.getBiometricLoginUserId).mockImplementationOnce(() => (
      new Promise<number | null>((resolve) => {
        resolveBiometricUser = resolve;
      })
    ));
    jest.mocked(authApi.login).mockResolvedValueOnce({
      status: 'authenticated',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      user: cachedUser,
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    await act(async () => {
      const loginPromise = currentAuth?.login('mobile-test', 'password');
      await Promise.resolve();
      expect(authApi.login).toHaveBeenCalledWith('mobile-test', 'password');
      resolveBiometricUser?.(cachedUser.id);
      await loginPromise;
    });
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
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

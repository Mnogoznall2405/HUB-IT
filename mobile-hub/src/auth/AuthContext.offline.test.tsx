import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import * as authApi from '../api/authApi';
import * as nativeConnectivity from '../network/nativeConnectivity';
import * as biometricAuth from './biometricAuth';
import * as tokenStore from './tokenStore';
import { AuthProvider, useAuth } from './AuthContext';
import { AppLockGate } from './AppLockGate';
import { endMobileSession } from './logout';

type ConnectivitySnapshot = {
  available: boolean;
  online: boolean;
  connected: boolean;
  transport: 'none' | 'wifi' | 'vpn';
  metered: boolean;
  changedAtMs: number;
};

const mockConnectivityListeners = new Set<(snapshot: ConnectivitySnapshot) => void>();
const mockAppStateListeners = new Set<(state: AppStateStatus) => void>();
const mockAppLockUnlock = jest.fn(async () => undefined);

function emitConnectivity(snapshot: ConnectivitySnapshot) {
  mockConnectivityListeners.forEach((listener) => listener(snapshot));
}

function emitAppState(state: AppStateStatus) {
  mockAppStateListeners.forEach((listener) => listener(state));
}

const OFFLINE_SNAPSHOT: ConnectivitySnapshot = {
  available: true,
  online: false,
  connected: false,
  transport: 'none',
  metered: false,
  changedAtMs: 10,
};

const WIFI_SNAPSHOT: ConnectivitySnapshot = {
  available: true,
  online: true,
  connected: true,
  transport: 'wifi',
  metered: false,
  changedAtMs: 11,
};

const TRANSPORT_ERROR = Object.assign(new Error('Network Error'), {
  isAxiosError: true,
  code: 'ERR_NETWORK',
  response: undefined,
});

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
    mockConnectivityListeners.add(listener);
    return { remove: jest.fn(() => mockConnectivityListeners.delete(listener)) };
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
  getRefreshToken: jest.fn(async () => null),
  getSessionUserId: jest.fn(async () => 7),
  getCachedSessionUser: jest.fn(async () => null),
  setCachedSessionUser: jest.fn(async () => undefined),
  setSessionUserId: jest.fn(async () => undefined),
  setTokens: jest.fn(async () => undefined),
  setClientDeviceId: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
  markSessionDeactivated: jest.fn(async () => undefined),
  readSessionDeactivationMark: jest.fn(async () => false),
  isSessionDeactivationMarked: jest.fn(() => false),
  clearDeactivatedTokens: jest.fn(async () => true),
}));

jest.mock('./biometricAuth', () => ({
  BiometricUnavailableError: class BiometricUnavailableError extends Error {},
  isBiometricLoginEnabled: jest.fn(async () => true),
  getBiometricLoginUserId: jest.fn(async () => 7),
  getAppLockSettings: jest.fn(async () => ({ enabled: false, timeoutSeconds: 60 })),
  shouldLockAfterBackground: jest.fn(() => false),
  subscribeAppLockSettings: jest.fn(() => jest.fn()),
  unlockBiometricAppLock: () => mockAppLockUnlock(),
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

jest.mock('expo-screen-capture', () => ({
  allowScreenCaptureAsync: jest.fn(async () => undefined),
  preventScreenCaptureAsync: jest.fn(async () => undefined),
}));

jest.mock('../native/haptics', () => ({
  hapticError: jest.fn(async () => undefined),
  hapticSuccess: jest.fn(async () => undefined),
}));

jest.mock('../accessibility/useReducedMotion', () => ({
  useReducedMotion: () => true,
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
      <Text testID="restore-state">{currentAuth.sessionRestoreState}</Text>
      <Text testID="conn-offline">{currentAuth.connectivityOffline ? 'offline' : 'online'}</Text>
      <Text testID="net-restricted">{currentAuth.sessionNetworkRestricted ? 'restricted' : 'allowed'}</Text>
      <Text testID="app-lock-pending">{currentAuth.appLockPendingUnlock ? 'pending' : 'clear'}</Text>
    </>
  );
}

async function settleAttempts() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AuthProvider offline session', () => {
  const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');

  beforeEach(() => {
    currentAuth = null;
    mockConnectivityListeners.clear();
    mockAppStateListeners.clear();
    mockAppLockUnlock.mockClear();
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      mockAppStateListeners.add(listener);
      return { remove: jest.fn(() => mockAppStateListeners.delete(listener)) };
    });
    jest.mocked(tokenStore.hasSession).mockResolvedValue(true);
    jest.mocked(tokenStore.getRefreshToken).mockResolvedValue(null);
    jest.mocked(tokenStore.getSessionUserId).mockResolvedValue(7);
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValue(cachedUser);
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
    jest.mocked(tokenStore.clearTokens).mockClear();
    jest.mocked(tokenStore.setCachedSessionUser).mockClear();
    jest.mocked(tokenStore.markSessionDeactivated).mockClear();
    jest.mocked(tokenStore.readSessionDeactivationMark).mockResolvedValue(false);
    jest.mocked(tokenStore.isSessionDeactivationMarked).mockReturnValue(false);
    jest.mocked(tokenStore.clearDeactivatedTokens).mockClear();
    jest.mocked(endMobileSession).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalState) Object.defineProperty(AppState, 'currentState', originalState);
    jest.useRealTimers();
  });

  it('opens the cached session instantly on a dead network and validates it in the background', async () => {
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue(OFFLINE_SNAPSHOT);
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(view.getByTestId('conn-offline').props.children).toBe('offline');
    expect(view.getByTestId('restore-state').props.children).toBe('checking');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
  });

  it('opens the cached session instantly when only a refresh token is stored', async () => {
    jest.mocked(tokenStore.hasSession).mockResolvedValue(false);
    jest.mocked(tokenStore.getRefreshToken).mockResolvedValue('stored-refresh');
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue(OFFLINE_SNAPSHOT);
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
  });

  it('replaces the cached identity and permissions after the background check succeeds', async () => {
    const freshUser = { ...cachedUser, permissions: ['dashboard.read', 'tasks.read'] };
    let resolveFetch: ((user: typeof freshUser) => void) | undefined;
    jest.mocked(authApi.fetchMe).mockImplementationOnce(() => new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(currentAuth?.hasPermission('tasks.read')).toBe(false);

    await act(async () => resolveFetch?.(freshUser));
    await waitFor(() => expect(view.getByTestId('offline-mode').props.children).toBe('online'));
    expect(currentAuth?.hasPermission('tasks.read')).toBe(true);
    expect(view.getByTestId('restore-state').props.children).toBe('idle');
    expect(tokenStore.setCachedSessionUser).toHaveBeenCalledWith(freshUser);
  });

  it('retries on every reachable connectivity event and reconnects after a transport change', async () => {
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      await act(async () => emitConnectivity({
        ...WIFI_SNAPSHOT,
        changedAtMs: 10 + attempt,
      }));
      await waitFor(() => expect(authApi.fetchMe).toHaveBeenCalledTimes(attempt));
      await settleAttempts();
    }
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();

    // The same connected state over a new transport (VPN on) is a fresh signal.
    jest.mocked(authApi.fetchMe).mockResolvedValue(cachedUser);
    await act(async () => emitConnectivity({
      ...WIFI_SNAPSHOT,
      transport: 'vpn',
      changedAtMs: 30,
    }));
    await waitFor(() => expect(view.getByTestId('offline-mode').props.children).toBe('online'));
    expect(authApi.fetchMe).toHaveBeenCalledTimes(5);
  });

  it('retries immediately when the app returns to the foreground', async () => {
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    await act(async () => emitAppState('background'));
    await act(async () => emitAppState('active'));
    await waitFor(() => expect(authApi.fetchMe).toHaveBeenCalledTimes(2));
  });

  it('keeps retrying once a minute after the short backoff is exhausted', async () => {
    jest.useFakeTimers();
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    // Failed attempts reschedule at 2 → 5 → 15 → 30 → 60 → 60 s.
    await act(async () => { await jest.advanceTimersByTimeAsync(2_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(5_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(3);
    await act(async () => { await jest.advanceTimersByTimeAsync(15_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(4);
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(5);
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(6);
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(7);
  });

  it('stops the retry timer in the background and resumes on return', async () => {
    jest.useFakeTimers();
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    await act(async () => emitAppState('background'));
    await act(async () => { await jest.advanceTimersByTimeAsync(120_000); });
    expect(authApi.fetchMe).toHaveBeenCalledTimes(1);

    await act(async () => emitAppState('active'));
    await waitFor(() => expect(authApi.fetchMe).toHaveBeenCalledTimes(2));
  });

  it('keeps the cached identity and cache when /auth/me answers malformed data', async () => {
    // The real fetchMe validates the payload; a captive portal answering 200
    // with HTML reaches the provider exactly like this rejection.
    jest.mocked(authApi.fetchMe).mockRejectedValue(new Error('Сервер вернул некорректный профиль пользователя'));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();

    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(tokenStore.setCachedSessionUser).not.toHaveBeenCalled();
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
  });

  it('keeps the session on a non-JSON 403 but expires it on a JSON 401', async () => {
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      response: { status: 403, headers: { 'content-type': 'text/html' } },
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();

    // An equally coded HTML page from a proxy or WAF is not a HUB-IT refusal.
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();

    jest.mocked(authApi.fetchMe).mockRejectedValue({
      response: { status: 401, headers: { 'content-type': 'application/json' } },
    });
    await act(async () => emitConnectivity({ ...WIFI_SNAPSHOT, changedAtMs: 20 }));
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(view.getByTestId('restore-state').props.children).toBe('expired');
    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: false });
    // An ordinary JSON 401 keeps the offline data — only the deactivation
    // signal runs the full wipe.
    expect(tokenStore.markSessionDeactivated).not.toHaveBeenCalled();
    expect(endMobileSession).not.toHaveBeenCalled();
  });

  it('wipes the account locally when the background check answers 401 + user_inactive', async () => {
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      isAxiosError: true,
      config: { url: '/auth/me' },
      response: {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-hubit-auth-reason': 'user_inactive',
        },
        data: { detail: 'User is not active' },
      },
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    // The cached identity is dropped and the full local wipe runs through the
    // logout path — but without any server request.
    expect(view.getByTestId('restore-state').props.children).toBe('deactivated');
    expect(currentAuth?.user).toBeNull();
    expect(currentAuth?.biometricEnabled).toBe(false);
    expect(view.getByTestId('offline-mode').props.children).toBe('online');
    expect(tokenStore.markSessionDeactivated).toHaveBeenCalledTimes(1);
    expect(endMobileSession).toHaveBeenCalledWith({ contactServer: false });
    // The wipe runs inside endMobileSession — no separate expiry path.
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
  });

  it('wipes the account on the legacy 400 «Inactive user» answer from /auth/me', async () => {
    // Servers before the C-1 rollout have no user_inactive header — the same
    // signal arrives as 400 + detail on /auth/me only.
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      isAxiosError: true,
      config: { url: '/auth/me' },
      response: {
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: { detail: 'Inactive user' },
      },
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    expect(view.getByTestId('restore-state').props.children).toBe('deactivated');
    expect(tokenStore.markSessionDeactivated).toHaveBeenCalledTimes(1);
    expect(endMobileSession).toHaveBeenCalledWith({ contactServer: false });
  });

  it('does not wipe the account on a 400 «Inactive user» from another endpoint', async () => {
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      isAxiosError: true,
      config: { url: '/profile' },
      response: {
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: { detail: 'Inactive user' },
      },
    });

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();

    // A 400 outside /auth/me is a transport anomaly — the session survives.
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(tokenStore.markSessionDeactivated).not.toHaveBeenCalled();
    expect(endMobileSession).not.toHaveBeenCalled();
  });

  it('finishes a deferred deactivation wipe on the next cold start', async () => {
    // A headless background sync may catch the user_inactive refresh rejection
    // while no UI is mounted: the persisted mark then owns the wipe at startup.
    jest.mocked(tokenStore.readSessionDeactivationMark).mockResolvedValue(true);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    expect(view.getByTestId('restore-state').props.children).toBe('deactivated');
    expect(view.queryByText('mobile-test')).toBeNull();
    expect(endMobileSession).toHaveBeenCalledWith({ contactServer: false });
    expect(authApi.fetchMe).not.toHaveBeenCalled();
  });

  it('keeps the session and reports the restriction on a JSON 403 from HUB-IT', async () => {
    // Backend check (deps.py: ensure_admin_ip_allowed): the only JSON 403 on
    // /auth/me is the admin IP allowlist — the session stays valid in the
    // office network, so the app must keep it and keep retrying.
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      response: {
        status: 403,
        headers: { 'content-type': 'application/json' },
        data: { detail: 'Admin access from this IP is not allowed' },
      },
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());
    await settleAttempts();

    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(view.getByTestId('net-restricted').props.children).toBe('restricted');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
    expect(view.getByText('mobile-test')).toBeTruthy();

    // A later transport failure clears the restriction notice…
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    await act(async () => emitConnectivity({ ...WIFI_SNAPSHOT, changedAtMs: 21 }));
    await waitFor(() => expect(view.getByTestId('net-restricted').props.children).toBe('allowed'));

    // …and a recovery from an allowed network ends the offline mode.
    jest.mocked(authApi.fetchMe).mockResolvedValue(cachedUser);
    await act(async () => emitConnectivity({ ...WIFI_SNAPSHOT, changedAtMs: 22 }));
    await waitFor(() => expect(view.getByTestId('offline-mode').props.children).toBe('online'));
    expect(view.getByTestId('net-restricted').props.children).toBe('allowed');
  });

  it('preserves the stored session on a JSON 403 without a cached profile', async () => {
    jest.mocked(tokenStore.getCachedSessionUser).mockResolvedValue(null);
    jest.mocked(authApi.fetchMe).mockRejectedValue({
      response: {
        status: 403,
        headers: { 'content-type': 'application/json' },
        data: { detail: 'Admin access from this IP is not allowed' },
      },
    });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    expect(view.getByTestId('restore-state').props.children).toBe('unavailable');
    expect(view.getByTestId('net-restricted').props.children).toBe('restricted');
    expect(tokenStore.clearTokens).not.toHaveBeenCalled();
  });

  it('ignores a cached identity whose id does not match the stored session user', async () => {
    jest.mocked(tokenStore.getSessionUserId).mockResolvedValue(8);
    jest.mocked(nativeConnectivity.getNativeConnectivitySnapshot).mockResolvedValue(OFFLINE_SNAPSHOT);

    const view = await render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());
    expect(view.getByTestId('offline-mode').props.children).toBe('offline');
    expect(authApi.fetchMe).not.toHaveBeenCalled();
  });

  it('expires the session when the server answers a different user id', async () => {
    jest.mocked(authApi.fetchMe).mockResolvedValue({ ...cachedUser, id: 8 });
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('locked')).toBeTruthy());

    expect(tokenStore.clearTokens).toHaveBeenCalledWith({ clearOfflineData: false });
    expect(view.getByTestId('restore-state').props.children).toBe('expired');
  });

  it('does not resurrect the session when logout lands during background recovery', async () => {
    let finishFetch: ((user: typeof cachedUser) => void) | undefined;
    jest.mocked(authApi.fetchMe).mockImplementation(() => new Promise((resolve) => {
      finishFetch = resolve;
    }));
    const view = await render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(view.getByText('mobile-test')).toBeTruthy());

    await act(async () => { await currentAuth!.logout(); });
    await act(async () => finishFetch?.(cachedUser));

    expect(currentAuth?.user).toBeNull();
    expect(view.getByText('locked')).toBeTruthy();
  });

  it('covers the cached content with the app lock when the lock is enabled', async () => {
    jest.mocked(biometricAuth.getAppLockSettings).mockResolvedValue({
      enabled: true,
      timeoutSeconds: 60,
    });
    jest.mocked(authApi.fetchMe).mockRejectedValue(TRANSPORT_ERROR);
    let finishLock: (() => void) | undefined;
    mockAppLockUnlock.mockImplementation(() => new Promise<undefined>((resolve) => {
      finishLock = () => resolve(undefined);
    }));

    const view = await render(<AuthProvider><AppLockGate /><Probe /></AuthProvider>);

    // The lock modal mounts in the same frame as the cached shell — content is
    // present underneath but never exposed ahead of the fingerprint prompt.
    await waitFor(() => expect(view.getByTestId('app-lock-scroll')).toBeTruthy());
    expect(view.getByText('mobile-test')).toBeTruthy();
    expect(view.getByTestId('app-lock-pending').props.children).toBe('pending');
    await waitFor(() => expect(mockAppLockUnlock).toHaveBeenCalled());

    await act(async () => finishLock?.());
    await waitFor(() => expect(view.queryByTestId('app-lock-scroll')).toBeNull());
    expect(view.getByTestId('app-lock-pending').props.children).toBe('clear');
  });
});

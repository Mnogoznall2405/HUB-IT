import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/authApi';
import type { HubUser, LoginResponse, TwoFactorSetupResponse } from '../api/types';
import * as tokenStore from './tokenStore';
import { subscribeSessionExpired } from './sessionEvents';
import { chatSocket } from '../chat/chatSocket';
import { endMobileSession } from './logout';
import {
  getNativeConnectivitySnapshot,
  subscribeNativeConnectivity,
  type NativeConnectivitySnapshot,
} from '../network/nativeConnectivity';
import { setNativeOfflineReadOnly } from '../offline/nativeOfflinePolicy';
import {
  disableBiometricLogin,
  enableBiometricLogin,
  getBiometricLoginUserId,
  isBiometricLoginEnabled,
  unlockBiometricLogin,
} from './biometricAuth';

export type BiometricUnlockResult = {
  user: HubUser;
  offline: boolean;
};

type AuthContextValue = {
  user: HubUser | null;
  loading: boolean;
  sessionRestoreState: 'idle' | 'checking' | 'unavailable' | 'expired';
  retrySessionRestore: () => void;
  loginChallengeId: string | null;
  biometricEnabled: boolean;
  biometricEnrollmentAvailable: boolean;
  offlineMode: boolean;
  vpnActive: boolean;
  offlineCacheKey: string | null;
  /** `setup` while native 2FA enrollment is in progress. */
  login: (username: string, password: string) => Promise<LoginResponse>;
  startTwoFactorSetup: () => Promise<TwoFactorSetupResponse>;
  verifyTwoFactorSetup: (code: string) => Promise<string[]>;
  verifyTwoFactor: (code: string, isBackup?: boolean) => Promise<void>;
  enableBiometrics: () => Promise<void>;
  skipBiometrics: () => Promise<void>;
  unlockOfflineCache: () => Promise<string>;
  unlockWithBiometrics: () => Promise<BiometricUnlockResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  completeAboutOnboarding: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_RESTORE_RETRY_DELAY_MS = 300;
const SESSION_RESTORE_TIMEOUT_MS = 5_000;
const RECENT_API_SUCCESS_GRACE_MS = 30_000;

function isTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  return !('response' in error) || (error as { response?: unknown }).response == null;
}

function isRequestTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code || '').toUpperCase();
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT';
}

async function restoreUserWithRetry(
  refreshUser: (timeoutMs: number) => Promise<void>,
  totalTimeoutMs: number,
): Promise<void> {
  const deadlineAtMs = Date.now() + totalTimeoutMs;
  const remainingTimeoutMs = () => Math.max(0, Math.trunc(deadlineAtMs - Date.now()));
  try {
    await refreshUser(totalTimeoutMs);
  } catch (error) {
    if (!isTransportFailure(error) || isRequestTimeout(error)) throw error;
    if (remainingTimeoutMs() <= SESSION_RESTORE_RETRY_DELAY_MS) throw error;
    await new Promise((resolve) => setTimeout(resolve, SESSION_RESTORE_RETRY_DELAY_MS));
    const retryTimeoutMs = remainingTimeoutMs();
    if (retryTimeoutMs <= 0) throw error;
    await refreshUser(retryTimeoutMs);
  }
}

async function persistLoginResult(result: LoginResponse, assertCurrent: () => void): Promise<void> {
  assertCurrent();
  if (result.client_device_id) {
    await tokenStore.setClientDeviceId(result.client_device_id);
    assertCurrent();
  }
  const access = String(result.access_token || '').trim();
  const refresh = String(result.refresh_token || '').trim();
  if (result.status === 'authenticated' && access && refresh) {
    await tokenStore.setTokens(access, refresh);
    assertCurrent();
    if (result.user?.id) await tokenStore.setSessionUserId(result.user.id);
    assertCurrent();
  }
}

function cacheSessionUserInBackground(user: HubUser): void {
  void tokenStore.setCachedSessionUser(user).catch(() => undefined);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const authGenerationRef = useRef(0);
  const logoutPromise = useRef<Promise<void> | null>(null);
  const [user, setUser] = useState<HubUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionRestoreState, setSessionRestoreState] = useState<AuthContextValue['sessionRestoreState']>('idle');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restorePending = useRef(true);
  const [loginChallengeId, setLoginChallengeId] = useState<string | null>(null);
  const [twoFactorSetupChallengeId, setTwoFactorSetupChallengeId] = useState<string | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricEnrollmentCode, setBiometricEnrollmentCode] = useState<string | null>(null);
  const [sessionOfflineMode, setSessionOfflineMode] = useState(false);
  const [connectivityOffline, setConnectivityOffline] = useState(false);
  const [connectivityKnownOnline, setConnectivityKnownOnline] = useState(false);
  const [vpnActive, setVpnActive] = useState(false);
  const [offlineCacheKey, setOfflineCacheKey] = useState<string | null>(null);
  const lastApiSuccessAtRef = useRef(0);
  const offlineMode = sessionOfflineMode || connectivityOffline;

  const markApiOnline = useCallback(() => {
    setSessionRestoreState('idle');
    lastApiSuccessAtRef.current = Date.now();
    setSessionOfflineMode(false);
    setConnectivityOffline(false);
    setConnectivityKnownOnline(true);
  }, []);

  useEffect(() => {
    setNativeOfflineReadOnly(offlineMode);
    return () => setNativeOfflineReadOnly(false);
  }, [offlineMode]);

  const refreshUser = useCallback(async () => {
    const generation = authGenerationRef.current;
    const me = await authApi.fetchMe();
    if (generation !== authGenerationRef.current) return;
    setUser(me);
    markApiOnline();
    cacheSessionUserInBackground(me);
  }, [markApiOnline]);

  const completeAboutOnboarding = useCallback(async () => {
    const completed = await authApi.completeAboutOnboarding();
    setUser(completed);
    await tokenStore.setCachedSessionUser(completed).catch(() => undefined);
  }, []);

  useEffect(() => {
    return subscribeSessionExpired(() => {
      authGenerationRef.current += 1;
      restorePending.current = false;
      setSessionRestoreState('expired');
      chatSocket.disconnect({ reconnect: false, clearSubscriptions: true });
      setUser(null);
      setLoginChallengeId(null);
      setTwoFactorSetupChallengeId(null);
      setBiometricEnrollmentCode(null);
      setSessionOfflineMode(false);
      setOfflineCacheKey(null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const applyConnectivity = (snapshot: NativeConnectivitySnapshot) => {
      if (!active || !snapshot.available) return;
      // VALIDATED is often absent on corporate Wi-Fi/VPN even while HUB is
      // reachable. A connected network is enough to probe the authenticated API.
      const canReachNetwork = snapshot.connected || snapshot.online;
      setVpnActive(snapshot.transport === 'vpn');
      if (
        !canReachNetwork
        && lastApiSuccessAtRef.current > 0
        && Date.now() - lastApiSuccessAtRef.current <= RECENT_API_SUCCESS_GRACE_MS
      ) {
        return;
      }
      setConnectivityOffline(!canReachNetwork);
      setConnectivityKnownOnline(canReachNetwork);
    };
    void getNativeConnectivitySnapshot().then(applyConnectivity).catch(() => undefined);
    const subscription = subscribeNativeConnectivity(applyConnectivity);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const generation = authGenerationRef.current;
    const isCurrent = () => active && !logoutPromise.current && generation === authGenerationRef.current;
    void (async () => {
      let cachedUser: HubUser | null = null;
      try {
        const [biometrics, hasSession, storedUser, initialConnectivity] = await Promise.all([
          isBiometricLoginEnabled(),
          tokenStore.hasSession(),
          tokenStore.getCachedSessionUser(),
          getNativeConnectivitySnapshot(),
        ]);
        if (!isCurrent()) return;
        setBiometricEnabled(biometrics);
        if (initialConnectivity.available) {
          const canReachNetwork = initialConnectivity.connected || initialConnectivity.online;
          setConnectivityOffline(!canReachNetwork);
          setConnectivityKnownOnline(canReachNetwork);
          setVpnActive(initialConnectivity.transport === 'vpn');
          if (!canReachNetwork) {
            setSessionOfflineMode(true);
            if (hasSession) setSessionRestoreState('unavailable');
            return;
          }
        }
        if (!hasSession) { setSessionRestoreState('idle'); return; }
        setSessionRestoreState('checking');
        cachedUser = storedUser;
        try {
          await restoreUserWithRetry(async (timeoutMs) => {
            if (!isCurrent()) return;
            const me = await authApi.fetchMe({ timeoutMs });
            if (!isCurrent()) return;
            setUser(me);
            markApiOnline();
            cacheSessionUserInBackground(me);
          }, SESSION_RESTORE_TIMEOUT_MS);
        } catch (error) {
          if (!isCurrent()) return;
          const status = Number(
            error && typeof error === 'object' && 'response' in error
              ? (error as { response?: { status?: number } }).response?.status
              : 0,
          );
          if (status === 401 || status === 403) {
            await tokenStore.clearTokens({ clearOfflineData: false });
            if (!isCurrent()) return;
            setUser(null);
            setSessionOfflineMode(false);
            setSessionRestoreState('expired');
          } else {
            setSessionRestoreState('unavailable');
            setUser(null);
            setSessionOfflineMode(true);
          }
        }
      } catch {
        if (isCurrent()) {
          if (!cachedUser) setUser(null);
          setSessionRestoreState('unavailable');
        }
      } finally {
        if (isCurrent()) { restorePending.current = false; setLoading(false); }
      }
    })();
    return () => {
      active = false;
    };
  }, [markApiOnline, restoreAttempt]);

  const retrySessionRestore = useCallback(() => {
    if (restorePending.current || user || loginChallengeId) return;
    restorePending.current = true;
    authGenerationRef.current += 1;
    setSessionOfflineMode(false);
    setSessionRestoreState('checking');
    setLoading(true);
    setRestoreAttempt((attempt) => attempt + 1);
  }, [user, loginChallengeId]);

  useEffect(() => {
    if (!sessionOfflineMode || !connectivityKnownOnline || logoutPromise.current) return undefined;
    let active = true;
    const generation = authGenerationRef.current;
    const isCurrent = () => active && !logoutPromise.current && generation === authGenerationRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retryDelays = [0, 2_000, 5_000, 15_000];

    const recover = async (attempt: number) => {
      if (!isCurrent()) return;
      try {
        const me = await authApi.fetchMe({ timeoutMs: SESSION_RESTORE_TIMEOUT_MS });
        if (!isCurrent()) return;
        setUser(me);
        markApiOnline();
        cacheSessionUserInBackground(me);
      } catch (error) {
        if (!isCurrent()) return;
        const status = Number(
          error && typeof error === 'object' && 'response' in error
            ? (error as { response?: { status?: number } }).response?.status
            : 0,
        );
        if (status === 401 || status === 403) {
          await tokenStore.clearTokens({ clearOfflineData: false });
          if (!isCurrent()) return;
          setUser(null);
          setSessionOfflineMode(false);
          setSessionRestoreState('expired');
          return;
        }
        const nextAttempt = attempt + 1;
        if (nextAttempt < retryDelays.length) {
          retryTimer = setTimeout(() => { void recover(nextAttempt); }, retryDelays[nextAttempt]);
        }
      }
    };

    void recover(0);
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [connectivityKnownOnline, markApiOnline, sessionOfflineMode]);

  const beginAuthentication = useCallback(() => {
    if (logoutPromise.current) throw new Error('Выход ещё выполняется. Дождитесь завершения и повторите вход.');
    const generation = ++authGenerationRef.current;
    setSessionOfflineMode(false);
    return () => {
      if (generation !== authGenerationRef.current || logoutPromise.current) {
        throw new Error('Попытка входа отменена. Повторите вход.');
      }
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const assertCurrent = beginAuthentication();
    restorePending.current = false;
    setLoading(false);
    setSessionRestoreState('idle');
    const enrolledBiometricUserIdPromise = getBiometricLoginUserId().catch(() => null);
    const result = await authApi.login(username, password);
    assertCurrent();
    setBiometricEnrollmentCode(null);
    await persistLoginResult(result, assertCurrent);
    if (result.status === '2fa_setup_required') {
      const challengeId = String(result.login_challenge_id || '').trim();
      if (!challengeId) throw new Error('Сервер не выдал запрос настройки 2FA');
      setTwoFactorSetupChallengeId(challengeId);
      setLoginChallengeId('setup');
      return result;
    }
    if (result.status === '2fa_required') {
      setTwoFactorSetupChallengeId(null);
      setLoginChallengeId(result.login_challenge_id || null);
      return result;
    }
    setLoginChallengeId(null);
    setTwoFactorSetupChallengeId(null);
    const enrolledBiometricUserId = await enrolledBiometricUserIdPromise;
    assertCurrent();
    const signedInUserId = Number(result.user?.id || 0);
    const preserveBiometrics = Boolean(
      enrolledBiometricUserId
      && signedInUserId > 0
      && enrolledBiometricUserId === signedInUserId,
    );
    if (!preserveBiometrics) await disableBiometricLogin();
    assertCurrent();
    setBiometricEnabled(preserveBiometrics);
    markApiOnline();
    setOfflineCacheKey(null);
    if (result.user) {
      setUser(result.user);
      cacheSessionUserInBackground(result.user);
    }
    else await refreshUser();
    assertCurrent();
    return result;
  }, [beginAuthentication, markApiOnline, refreshUser]);

  const startTwoFactorSetup = useCallback(async () => {
    if (!twoFactorSetupChallengeId) throw new Error('Запрос настройки 2FA истёк. Войдите снова');
    if (logoutPromise.current) throw new Error('Выход ещё выполняется. Дождитесь завершения и повторите вход.');
    const generation = authGenerationRef.current;
    const result = await authApi.startTwoFactorSetup(twoFactorSetupChallengeId);
    if (generation !== authGenerationRef.current || logoutPromise.current) {
      throw new Error('Запрос настройки 2FA истёк. Войдите снова');
    }
    return result;
  }, [twoFactorSetupChallengeId]);

  const verifyTwoFactorSetup = useCallback(async (code: string) => {
    const assertCurrent = beginAuthentication();
    if (!twoFactorSetupChallengeId) throw new Error('Запрос настройки 2FA истёк. Войдите снова');
    const result = await authApi.verifyTwoFactorSetup(twoFactorSetupChallengeId, code);
    await persistLoginResult(result, assertCurrent);
    setBiometricEnrollmentCode(String(result.biometric_enrollment_code || '').trim() || null);
    setLoginChallengeId(null);
    setTwoFactorSetupChallengeId(null);
    markApiOnline();
    setOfflineCacheKey(null);
    if (result.user) {
      setUser(result.user);
      cacheSessionUserInBackground(result.user);
    } else await refreshUser();
    assertCurrent();
    return Array.isArray(result.backup_codes) ? result.backup_codes : [];
  }, [beginAuthentication, markApiOnline, refreshUser, twoFactorSetupChallengeId]);

  const verifyTwoFactor = useCallback(async (code: string, isBackup = false) => {
    const assertCurrent = beginAuthentication();
    if (!loginChallengeId) throw new Error('Missing login challenge');
    const result = await authApi.verifyTwoFactorLogin(loginChallengeId, isBackup
      ? { backup_code: code }
      : { totp_code: code });
    await persistLoginResult(result, assertCurrent);
    setBiometricEnrollmentCode(String(result.biometric_enrollment_code || '').trim() || null);
    setLoginChallengeId(null);
    setTwoFactorSetupChallengeId(null);
    markApiOnline();
    if (result.user) {
      setUser(result.user);
      cacheSessionUserInBackground(result.user);
    }
    else await refreshUser();
    assertCurrent();
  }, [beginAuthentication, loginChallengeId, markApiOnline, refreshUser]);

  const currentSessionGuard = useCallback(() => {
    const generation = authGenerationRef.current;
    const assertCurrent = () => {
      if (generation !== authGenerationRef.current || logoutPromise.current) {
        throw new Error('Сессия изменилась. Повторите действие после входа.');
      }
    };
    assertCurrent();
    return assertCurrent;
  }, []);

  const enableBiometrics = useCallback(async () => {
    const assertCurrent = currentSessionGuard();
    if (!user) throw new Error('Сначала завершите вход');
    if (!biometricEnrollmentCode) {
      throw new Error('Для включения отпечатка заново войдите в APK и подтвердите двухфакторный код');
    }
    const renewalToken = await authApi.enrollMobileBiometricSession(biometricEnrollmentCode);
    assertCurrent();
    const credential = await enableBiometricLogin(user, renewalToken);
    assertCurrent();
    setBiometricEnrollmentCode(null);
    setBiometricEnabled(true);
    setSessionOfflineMode(false);
    setOfflineCacheKey(credential.offlineCacheKey);
  }, [biometricEnrollmentCode, currentSessionGuard, user]);

  const skipBiometrics = useCallback(async () => {
    const assertCurrent = currentSessionGuard();
    await authApi.revokeMobileBiometricSession().catch(() => undefined);
    assertCurrent();
    await disableBiometricLogin();
    assertCurrent();
    setBiometricEnrollmentCode(null);
    setBiometricEnabled(false);
    setSessionOfflineMode(false);
    setOfflineCacheKey(null);
  }, [currentSessionGuard]);

  const unlockOfflineCache = useCallback(async (): Promise<string> => {
    const assertCurrent = currentSessionGuard();
    if (!user) throw new Error('Сначала войдите в HUB-IT');
    const credential = await unlockBiometricLogin();
    assertCurrent();
    if (Number(credential.user.id) !== Number(user.id)) {
      await disableBiometricLogin();
    assertCurrent();
      setBiometricEnabled(false);
      setOfflineCacheKey(null);
      throw new Error('Офлайн-данные принадлежат другому пользователю. Войдите заново.');
    }
    setOfflineCacheKey(credential.offlineCacheKey);
    return credential.offlineCacheKey;
  }, [currentSessionGuard, user]);

  const unlockWithBiometrics = useCallback(async (): Promise<BiometricUnlockResult> => {
    const assertCurrent = beginAuthentication();
    const generation = authGenerationRef.current;
    setLoading(true);
    try {
      const credential = await unlockBiometricLogin();
      assertCurrent();
      setOfflineCacheKey(credential.offlineCacheKey);
      try {
        let currentUser: HubUser;
        if (credential.version === 2) {
          const renewed = await authApi.renewMobileBiometricSession(credential.renewalToken);
          await persistLoginResult(renewed, assertCurrent);
          currentUser = renewed.user || await authApi.fetchMe();
        } else {
          currentUser = await authApi.fetchMe();
        }
        assertCurrent();
        setUser(currentUser);
        cacheSessionUserInBackground(currentUser);
        markApiOnline();
        return { user: currentUser, offline: false };
      } catch (error: unknown) {
        assertCurrent();
        const status = Number(
          error
          && typeof error === 'object'
          && 'response' in error
            ? (error as { response?: { status?: number } }).response?.status
            : 0,
        );
        if (status === 401 || status === 403) {
          await skipBiometrics();
          throw new Error('Сессия завершена. Войдите по логину и паролю.');
        }
        setUser(credential.user);
        cacheSessionUserInBackground(credential.user);
        setSessionOfflineMode(true);
        return { user: credential.user, offline: true };
      }
    } finally {
      if (generation === authGenerationRef.current) setLoading(false);
    }
  }, [beginAuthentication, markApiOnline, skipBiometrics]);

  const logout = useCallback(async () => {
    if (logoutPromise.current) return logoutPromise.current;
    authGenerationRef.current += 1;
    const pending = (async () => {
    await endMobileSession();
    setUser(null);
    setLoginChallengeId(null);
    setTwoFactorSetupChallengeId(null);
    setBiometricEnrollmentCode(null);
    setBiometricEnabled(false);
    setSessionOfflineMode(false);
    setOfflineCacheKey(null);
    })();
    logoutPromise.current = pending;
    try { await pending; }
    finally { if (logoutPromise.current === pending) logoutPromise.current = null; }
  }, []);

  const hasPermission = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionRestoreState,
      retrySessionRestore,
      loginChallengeId,
      biometricEnabled,
      biometricEnrollmentAvailable: Boolean(biometricEnrollmentCode),
      offlineMode,
      vpnActive,
      offlineCacheKey,
      login,
      startTwoFactorSetup,
      verifyTwoFactorSetup,
      verifyTwoFactor,
      enableBiometrics,
      skipBiometrics,
      unlockOfflineCache,
      unlockWithBiometrics,
      logout,
      refreshUser,
      completeAboutOnboarding,
      hasPermission,
    }),
    [
      user,
      loading,
      sessionRestoreState,
      retrySessionRestore,
      loginChallengeId,
      biometricEnabled,
      biometricEnrollmentCode,
      offlineMode,
      vpnActive,
      offlineCacheKey,
      login,
      startTwoFactorSetup,
      verifyTwoFactorSetup,
      verifyTwoFactor,
      enableBiometrics,
      skipBiometrics,
      unlockOfflineCache,
      unlockWithBiometrics,
      logout,
      refreshUser,
      completeAboutOnboarding,
      hasPermission,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

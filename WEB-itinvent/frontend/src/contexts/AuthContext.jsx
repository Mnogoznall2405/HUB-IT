/**
 * Authentication Context - manages user authentication state across the app.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { authAPI } from '../api/client';
import { disableChatPushSubscription } from '../lib/chatNotifications';
import { clearAllMailRecentCache } from '../lib/mailRecentCache';
import { clearMobileOfflineCache } from '../lib/mobileOfflineCache';
import { isMailSessionEnabled, MAIL_SESSION_CHANGED_EVENT } from '../lib/mailSession';
import { clearSWRCache } from '../lib/swrCache';
import { synchronizePrivateMediaSession } from '../lib/privateMediaSession';
import { synchronizeBrowserAccount } from '../lib/browserAccountSession';

const AuthContext = createContext(null);
const alwaysGrantedPermissions = [
  'address_book.read',
  'announcements.read',
  'chat.ai.use',
  'chat.read',
  'chat.write',
  'company_structure.read',
  'dashboard.read',
  'docflow.act',
  'docflow.read',
  'mail.access',
  'my_files.read',
  'my_files.share',
  'my_files.write',
  'settings.read',
  'tasks.create',
  'tasks.read',
];
const rolePermissionFallback = {
  viewer: [
    'dashboard.read',
    'tasks.read',
    'tasks.create',
    'chat.read',
    'chat.write',
    'chat.ai.use',
    'kb.read',
    'mail.access',
    'settings.read',
    'company_structure.read',
  ],
  operator: [
    'dashboard.read',
    'announcements.write',
    'tasks.read',
    'tasks.create',
    'tasks.write',
    'chat.read',
    'chat.write',
    'chat.ai.use',
    'database.read',
    'database.write',
    'mfu.read',
    'networks.read',
    'networks.write',
    'computers.read',
    'scan.read',
    'scan.ack',
    'scan.tasks',
    'statistics.read',
    'kb.read',
    'kb.write',
    'mail.access',
    'settings.read',
    'vcs.read',
    'company_structure.read',
    'it_objects.read',
  ],
  admin: [
    'dashboard.read',
    'announcements.write',
    'announcements.moderate',
    'tasks.read',
    'tasks.create',
    'tasks.write',
    'tasks.review',
    'tasks.manage_all',
    'chat.read',
    'chat.write',
    'chat.ai.use',
    'chat.ai.sandbox',
    'database.read',
    'database.write',
    'mfu.read',
    'networks.read',
    'networks.write',
    'computers.read',
    'computers.read_all',
    'scan.read',
    'scan.ack',
    'scan.tasks',
    'statistics.read',
    'kb.read',
    'kb.write',
    'kb.publish',
    'kb.manage_all',
    'mail.access',
    'settings.read',
    'departments.manage',
    'ad_users.read',
    'ad_users.manage',
    'settings.users.manage',
    'settings.sessions.manage',
    'settings.ai.manage',
    'vcs.read',
    'vcs.manage',
    'tickets.read',
    'tickets.write',
    'tickets.personal_data.read',
    'address_book.read',
    'address_book.dismissed.read',
    'address_book.age.read',
    'address_book.hire_date.read',
    'address_book.personal_phone.read',
    'address_book.personal_email.read',
    'address_book.inn.read',
    'company_structure.read',
    'company_structure.write',
    'construction.read',
    'construction.write',
    'it_objects.read',
    'it_objects.manage',
  ],
};

const normalizeUserWithPermissions = (value) => {
  if (!value || typeof value !== 'object') return null;
  const role = String(value.role || 'viewer').trim().toLowerCase() || 'viewer';
  const rawPermissions = Array.isArray(value.permissions) ? value.permissions : rolePermissionFallback[role] || rolePermissionFallback.viewer;
  const permissions = [...new Set([
    ...rawPermissions.map((item) => String(item || '').trim()).filter(Boolean),
    ...alwaysGrantedPermissions,
  ])];
  return { ...value, role, permissions };
};

// FastAPI answers 422 with `detail` as an array of {msg, loc}; the UI needs a plain string.
const resolveErrorDetail = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => (typeof item === 'string' ? item : String(item?.msg || '')).trim())
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  return fallback;
};

const isLoginRoute = () => {
  if (typeof window === 'undefined') return false;
  const pathname = String(window.location?.pathname || '').replace(/\/+$/, '') || '/';
  return pathname === '/login';
};

const SESSION_RECOVERY_RETRY_DELAYS_MS = [1000, 2000, 5000, 15000, 30000];

const isDefinitiveSessionRejection = (requestError) => {
  const status = Number(requestError?.response?.status || 0);
  return status === 401 || status === 403;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mailSessionEnabled, setMailSessionEnabled] = useState(() => isMailSessionEnabled());

  const sessionRefreshGateRef = useRef(null);
  const sessionGenerationRef = useRef(0);
  const currentUserRef = useRef(null);
  const mediaSessionUserKeyRef = useRef('');

  const invalidateSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    sessionRefreshGateRef.current = null;
    currentUserRef.current = null;
    mediaSessionUserKeyRef.current = '';
    clearSWRCache();
    localStorage.removeItem('user');
    synchronizeBrowserAccount();
    clearAllMailRecentCache();
    setUser(null);
    setLoading(false);
    const generation = sessionGenerationRef.current;
    return synchronizePrivateMediaSession('', { clear: true }).then((cleared) => {
      if (!cleared && generation === sessionGenerationRef.current) setError('Не удалось полностью очистить локальный кэш вложений.');
      return cleared;
    });
  }, []);

  const applySessionUser = useCallback(async (currentUser, generation) => {
    const previousKey = String(currentUserRef.current?.id ?? currentUserRef.current?.username ?? '');
    const currentKey = String(currentUser?.id ?? currentUser?.username ?? '');
    if (previousKey !== currentKey) clearSWRCache();
    await synchronizePrivateMediaSession(currentKey, { clear: Boolean(previousKey && previousKey !== currentKey) });
    if (generation !== sessionGenerationRef.current) return false;
    mediaSessionUserKeyRef.current = currentKey;
    currentUserRef.current = currentUser || null;
    setUser(currentUser || null);
    if (currentUser && typeof currentUser === 'object') {
      localStorage.setItem('user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('user');
    }
    synchronizeBrowserAccount(currentKey);
    return true;
  }, []);

  useEffect(() => {
    const controllerChanged = () => {
      void synchronizePrivateMediaSession(mediaSessionUserKeyRef.current);
    };
    navigator.serviceWorker?.addEventListener?.('controllerchange', controllerChanged);
    return () => navigator.serviceWorker?.removeEventListener?.('controllerchange', controllerChanged);
  }, []);

  const refreshSession = useCallback(async ({ suppressAuthRequired = false } = {}) => {
    if (sessionRefreshGateRef.current) {
      return sessionRefreshGateRef.current;
    }

    const generation = sessionGenerationRef.current;
    sessionRefreshGateRef.current = (async () => {
      try {
        const currentUser = normalizeUserWithPermissions(
          await authAPI.getCurrentUser({ suppressAuthRequired })
        );
        if (generation !== sessionGenerationRef.current) return null;
        if (!(await applySessionUser(currentUser, generation))) return null;
        return currentUser || null;
      } catch (refreshError) {
        if (generation === sessionGenerationRef.current && isDefinitiveSessionRejection(refreshError)) {
          await invalidateSession();
        }
        throw refreshError;
      } finally {
        if (generation === sessionGenerationRef.current) sessionRefreshGateRef.current = null;
      }
    })();

    return sessionRefreshGateRef.current;
  }, [applySessionUser, invalidateSession]);

  // Restore cached user and validate active cookie session
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    let cancelled = false;
    if (!savedUser) synchronizeBrowserAccount();

    if (savedUser) {
      try {
        const cachedUser = normalizeUserWithPermissions(JSON.parse(savedUser));
        if (cachedUser) {
          currentUserRef.current = cachedUser;
          const generation = sessionGenerationRef.current;
          const cachedKey = String(cachedUser.id ?? cachedUser.username ?? '');
          // Preserve the existing offline session policy, but establish its own
          // media scope before showing cached-user UI. A later logout wins.
          void synchronizePrivateMediaSession(cachedKey).then(() => {
            if (cancelled || generation !== sessionGenerationRef.current || currentUserRef.current !== cachedUser) return;
            mediaSessionUserKeyRef.current = cachedKey;
            synchronizeBrowserAccount(cachedKey);
            setUser(cachedUser);
            setLoading(false);
          });
        }
      } catch (e) {
        console.error('Failed to parse saved user:', e);
        localStorage.removeItem('user');
        synchronizeBrowserAccount();
      }
    }

    let checkInFlight = false;
    let retryTimer = null;
    let retryAttempt = 0;
    let definitiveRejection = false;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleRetry = () => {
      if (cancelled || definitiveRejection || retryTimer !== null) return;
      const retryDelay = SESSION_RECOVERY_RETRY_DELAYS_MS[
        Math.min(retryAttempt, SESSION_RECOVERY_RETRY_DELAYS_MS.length - 1)
      ];
      retryAttempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void verifySession();
      }, retryDelay);
    };

    const verifySession = async () => {
      if (cancelled || definitiveRejection || checkInFlight) return;
      checkInFlight = true;
      const generation = sessionGenerationRef.current;
      try {
        await refreshSession({ suppressAuthRequired: true });
        if (!cancelled && generation === sessionGenerationRef.current) {
          retryAttempt = 0;
          setLoading(false);
        }
      } catch (requestError) {
        if (cancelled) return;
        if (isDefinitiveSessionRejection(requestError)) {
          definitiveRejection = true;
          setLoading(false);
        } else if (generation === sessionGenerationRef.current) {
          scheduleRetry();
        }
      } finally {
        checkInFlight = false;
      }
    };

    const retrySessionImmediately = () => {
      if (cancelled || definitiveRejection) return;
      clearRetryTimer();
      void verifySession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        retrySessionImmediately();
      }
    };

    window.addEventListener('online', retrySessionImmediately);
    window.addEventListener('focus', retrySessionImmediately);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void verifySession();

    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener('online', retrySessionImmediately);
      window.removeEventListener('focus', retrySessionImmediately);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshSession]);

  useEffect(() => {
    const onAuthRequired = () => {
      invalidateSession();
      setLoading(false);
      window.dispatchEvent(new Event('auth-changed'));
    };
    window.addEventListener('auth-required', onAuthRequired);
    return () => window.removeEventListener('auth-required', onAuthRequired);
  }, [invalidateSession]);

  useEffect(() => {
    const syncMailSession = () => setMailSessionEnabled(isMailSessionEnabled());
    window.addEventListener(MAIL_SESSION_CHANGED_EVENT, syncMailSession);
    return () => window.removeEventListener(MAIL_SESSION_CHANGED_EVENT, syncMailSession);
  }, []);

  // The stored choice is keyed by login: re-evaluate when the user changes.
  useEffect(() => {
    setMailSessionEnabled(isMailSessionEnabled());
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const verifySharedLogin = async (attempt = 0) => {
      const generation = sessionGenerationRef.current;
      try {
        await refreshSession({ suppressAuthRequired: true });
        if (!cancelled && generation === sessionGenerationRef.current) {
          setLoading(false);
          window.dispatchEvent(new Event('auth-changed'));
        }
      } catch (requestError) {
        if (cancelled || generation !== sessionGenerationRef.current) return;
        if (isDefinitiveSessionRejection(requestError)) {
          setLoading(false);
          return;
        }
        const retryDelay = SESSION_RECOVERY_RETRY_DELAYS_MS[
          Math.min(attempt, SESSION_RECOVERY_RETRY_DELAYS_MS.length - 1)
        ];
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void verifySharedLogin(attempt + 1);
        }, retryDelay);
      }
    };

    const onSharedAuthChanged = (event) => {
      if (event.key !== 'user' || (event.storageArea && event.storageArea !== localStorage)) {
        return;
      }

      clearRetryTimer();
      if (event.newValue === null) {
        invalidateSession();
        setLoading(false);
        window.dispatchEvent(new Event('auth-changed'));
        return;
      }

      let announcedUser = null;
      try {
        announcedUser = JSON.parse(event.newValue);
      } catch {
        // Treat an invalid shared cache as an unverified identity.
      }
      const announcedKey = String(announcedUser?.id ?? announcedUser?.username ?? '');
      const currentKey = String(currentUserRef.current?.id ?? currentUserRef.current?.username ?? '');
      if (announcedKey !== currentKey) {
        synchronizeBrowserAccount();
        sessionGenerationRef.current += 1;
        sessionRefreshGateRef.current = null;
        clearSWRCache();
        clearAllMailRecentCache();
        currentUserRef.current = null;
        setUser(null);
        setLoading(true);
      }
      void verifySharedLogin();
    };

    window.addEventListener('storage', onSharedAuthChanged);
    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener('storage', onSharedAuthChanged);
    };
  }, [refreshSession, invalidateSession]);

  // Silent refresh before access JWT expires (default 15m). Keeps cookies warm
  // even when the tab has no API traffic (chat WS alone used to miss idle touch).
  useEffect(() => {
    if (!user) return undefined;

    const ACCESS_TTL_MS = 15 * 60 * 1000;
    const REFRESH_EVERY_MS = Math.max(60_000, ACCESS_TTL_MS - 3 * 60 * 1000);
    let inFlight = false;

    const runSilentRefresh = async () => {
      if (inFlight || isLoginRoute()) return;
      inFlight = true;
      try {
        await authAPI.refresh();
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('auth-token-refreshed'));
        }
      } catch {
        // Interceptor / auth-required handles hard failures.
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void runSilentRefresh();
    }, REFRESH_EVERY_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runSilentRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  /**
   * Login with username and password
   */
  const applyAuthenticatedPayload = useCallback(async (payload) => {
    const currentUser = normalizeUserWithPermissions(payload?.user);
    sessionGenerationRef.current += 1;
    sessionRefreshGateRef.current = null;
    if (!(await applySessionUser(currentUser, sessionGenerationRef.current))) {
      throw new Error('Вход отменён: состояние сессии изменилось.');
    }
    window.dispatchEvent(new Event('auth-changed'));
    return currentUser;
  }, [applySessionUser]);

  const login = useCallback(async (username, password) => {
    setError(null);
    try {
      const response = await authAPI.login(username, password);
      if (response?.status === 'authenticated' && response?.user) {
        const currentUser = await applyAuthenticatedPayload(response);
        return { success: true, status: 'authenticated', user: currentUser, session_id: response?.session_id || null };
      }
      return {
        success: true,
        status: response?.status || '2fa_required',
        login_challenge_id: response?.login_challenge_id || null,
        available_second_factors: Array.isArray(response?.available_second_factors) ? response.available_second_factors : [],
        trusted_devices_available: Boolean(response?.trusted_devices_available),
      };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Ошибка входа');
      const statusCode = Number(err.response?.status || 0) || 0;
      const retryAfterHeader = err.response?.headers?.['retry-after'] ?? err.response?.headers?.['Retry-After'];
      const retryAfterSeconds = Number(retryAfterHeader);
      setError(message);
      return {
        success: false,
        error: message,
        statusCode,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds
          : undefined,
      };
    }
  }, [applyAuthenticatedPayload]);

  const verifyTwoFactorSetup = useCallback(async (loginChallengeId, totpCode) => {
    setError(null);
    try {
      const response = await authAPI.verifyTwoFactorSetup(loginChallengeId, totpCode);
      const currentUser = await applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
        backup_codes: Array.isArray(response?.backup_codes) ? response.backup_codes : [],
      };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось завершить настройку 2FA');
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const startTwoFactorSetup = useCallback(async (loginChallengeId) => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.startTwoFactorSetup(loginChallengeId)) };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось подготовить настройку 2FA');
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyTwoFactorLogin = useCallback(async (loginChallengeId, payload = {}) => {
    setError(null);
    try {
      const response = await authAPI.verifyTwoFactorLogin(loginChallengeId, payload);
      const currentUser = await applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось подтвердить вход');
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const refreshTrustedDeviceAuth = useCallback(async (loginChallengeId) => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.getTrustedDeviceAuthOptions(loginChallengeId)) };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось начать WebAuthn-подтверждение');
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyTrustedDeviceAuth = useCallback(async (loginChallengeId, challengeId, credential) => {
    setError(null);
    try {
      const response = await authAPI.verifyTrustedDeviceAuth(loginChallengeId, challengeId, credential);
      const currentUser = await applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось подтвердить доверенное устройство');
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const startPasskeyLogin = useCallback(async () => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.getPasskeyLoginOptions()) };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось начать вход по биометрии');
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyPasskeyLogin = useCallback(async (challengeId, credential) => {
    setError(null);
    try {
      const response = await authAPI.verifyPasskeyLogin(challengeId, credential);
      const currentUser = await applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = resolveErrorDetail(err, 'Не удалось завершить вход по биометрии');
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  /**
   * Logout current user
   */
  const logout = useCallback(async () => {
    // A /me response started before logout must not restore this session.
    sessionGenerationRef.current += 1;
    sessionRefreshGateRef.current = null;
    try {
      await disableChatPushSubscription({ removeServer: true });
    } catch (cleanupError) {
      console.error('Chat push cleanup error:', cleanupError);
    }
      try {
        await authAPI.logout();
      } catch (err) {
        console.error('Logout error:', err);
      } finally {
        await clearMobileOfflineCache().catch(() => 0);
        const lastUsername = String(user?.username || '').trim();
        if (lastUsername) {
          localStorage.setItem('hubit.login.last-username', lastUsername);
        }
        // Always clear local user cache
        await invalidateSession();
        window.dispatchEvent(new Event('auth-changed'));
      }
  }, [invalidateSession, user?.username]);

  /**
   * Check if user is authenticated
   */
  const isAuthenticated = useCallback(() => {
    return !!user;
  }, [user]);

  const hasPermission = useCallback((permission) => {
    const target = String(permission || '').trim();
    if (!target) return false;
    if (target === 'mail.access' && !mailSessionEnabled) return false;
    if (String(user?.role || '').trim().toLowerCase() === 'admin') {
      return true;
    }
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    return permissions.includes(target);
  }, [user, mailSessionEnabled]);

  const hasAnyPermission = useCallback((permissions) => {
    if (!Array.isArray(permissions) || permissions.length === 0) return false;
    return permissions.some((permission) => hasPermission(permission));
  }, [hasPermission]);

  const value = {
    user,
    loading,
    error,
    login,
    startTwoFactorSetup,
    verifyTwoFactorSetup,
    verifyTwoFactorLogin,
    startPasskeyLogin,
    verifyPasskeyLogin,
    refreshTrustedDeviceAuth,
    verifyTrustedDeviceAuth,
    logout,
    refreshSession,
    isAuthenticated,
    hasPermission,
    hasAnyPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;

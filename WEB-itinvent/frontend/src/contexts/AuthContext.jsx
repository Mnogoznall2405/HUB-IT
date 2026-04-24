/**
 * Authentication Context - manages user authentication state across the app.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../api/client';
import { disableChatPushSubscription } from '../lib/chatNotifications';
import { clearAllMailRecentCache } from '../lib/mailRecentCache';

const AuthContext = createContext(null);
const rolePermissionFallback = {
  viewer: [
    'dashboard.read',
    'tasks.read',
    'chat.read',
    'chat.write',
    'database.read',
    'networks.read',
    'computers.read',
    'scan.read',
    'statistics.read',
    'settings.read',
    'vcs.read',
  ],
  operator: [
    'dashboard.read',
    'announcements.write',
    'tasks.read',
    'tasks.write',
    'chat.read',
    'chat.write',
    'chat.ai.use',
    'database.read',
    'database.write',
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
  ],
  admin: [
    'dashboard.read',
    'announcements.write',
    'tasks.read',
    'tasks.write',
    'tasks.review',
    'chat.read',
    'chat.write',
    'chat.ai.use',
    'database.read',
    'database.write',
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
    'mail.access',
    'settings.read',
    'settings.users.manage',
    'settings.sessions.manage',
    'settings.ai.manage',
    'vcs.read',
    'vcs.manage',
  ],
};

const normalizeUserWithPermissions = (value) => {
  if (!value || typeof value !== 'object') return null;
  const role = String(value.role || 'viewer').trim().toLowerCase() || 'viewer';
  const rawPermissions = Array.isArray(value.permissions) ? value.permissions : rolePermissionFallback[role] || rolePermissionFallback.viewer;
  const permissions = [...new Set(rawPermissions.map((item) => String(item || '').trim()).filter(Boolean))];
  return { ...value, role, permissions };
};

const isLoginRoute = () => {
  if (typeof window === 'undefined') return false;
  const pathname = String(window.location?.pathname || '').replace(/\/+$/, '') || '/';
  return pathname === '/login';
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

  const refreshSession = useCallback(async ({ suppressAuthRequired = false } = {}) => {
    try {
      const currentUser = normalizeUserWithPermissions(
        await authAPI.getCurrentUser({ suppressAuthRequired })
      );
      setUser(currentUser || null);
      if (currentUser && typeof currentUser === 'object') {
        localStorage.setItem('user', JSON.stringify(currentUser));
      } else {
        localStorage.removeItem('user');
      }
      return currentUser || null;
    } catch (refreshError) {
      setUser(null);
      localStorage.removeItem('user');
      clearAllMailRecentCache();
      throw refreshError;
    }
  }, []);

  // Restore cached user and validate active cookie session
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    let hasCachedUser = false;

    if (savedUser) {
      try {
        const cachedUser = normalizeUserWithPermissions(JSON.parse(savedUser));
        if (cachedUser) {
          setUser(cachedUser);
          hasCachedUser = true;
        }
      } catch (e) {
        console.error('Failed to parse saved user:', e);
        localStorage.removeItem('user');
      }
    }

    if (!hasCachedUser && isLoginRoute()) {
      setLoading(false);
      return;
    }

    if (hasCachedUser) {
      setLoading(false);
    }

    const verifySession = async () => {
      try {
        await refreshSession({ suppressAuthRequired: true });
      } catch {
        setUser(null);
        localStorage.removeItem('user');
      } finally {
        setLoading(false);
      }
    };

    verifySession();
  }, [refreshSession]);

  useEffect(() => {
    const onAuthRequired = () => {
      localStorage.removeItem('user');
      clearAllMailRecentCache();
      setUser(null);
      setLoading(false);
      window.dispatchEvent(new Event('auth-changed'));
    };
    window.addEventListener('auth-required', onAuthRequired);
    return () => window.removeEventListener('auth-required', onAuthRequired);
  }, []);

  /**
   * Login with username and password
   */
  const applyAuthenticatedPayload = useCallback((payload) => {
    const currentUser = normalizeUserWithPermissions(payload?.user);
    localStorage.setItem('user', JSON.stringify(currentUser));
    setUser(currentUser);
    window.dispatchEvent(new Event('auth-changed'));
    return currentUser;
  }, []);

  const login = useCallback(async (username, password) => {
    setError(null);
    try {
      const response = await authAPI.login(username, password);
      if (response?.status === 'authenticated' && response?.user) {
        const currentUser = applyAuthenticatedPayload(response);
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
      const message = err.response?.data?.detail || 'Ошибка входа';
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const verifyTwoFactorSetup = useCallback(async (loginChallengeId, totpCode) => {
    setError(null);
    try {
      const response = await authAPI.verifyTwoFactorSetup(loginChallengeId, totpCode);
      const currentUser = applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
        backup_codes: Array.isArray(response?.backup_codes) ? response.backup_codes : [],
      };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось завершить настройку 2FA';
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const startTwoFactorSetup = useCallback(async (loginChallengeId) => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.startTwoFactorSetup(loginChallengeId)) };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось подготовить настройку 2FA';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyTwoFactorLogin = useCallback(async (loginChallengeId, payload = {}) => {
    setError(null);
    try {
      const response = await authAPI.verifyTwoFactorLogin(loginChallengeId, payload);
      const currentUser = applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось подтвердить вход';
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const refreshTrustedDeviceAuth = useCallback(async (loginChallengeId) => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.getTrustedDeviceAuthOptions(loginChallengeId)) };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось начать WebAuthn-подтверждение';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyTrustedDeviceAuth = useCallback(async (loginChallengeId, challengeId, credential) => {
    setError(null);
    try {
      const response = await authAPI.verifyTrustedDeviceAuth(loginChallengeId, challengeId, credential);
      const currentUser = applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось подтвердить доверенное устройство';
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  const startPasskeyLogin = useCallback(async () => {
    setError(null);
    try {
      return { success: true, ...(await authAPI.getPasskeyLoginOptions()) };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось начать вход по биометрии';
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  const verifyPasskeyLogin = useCallback(async (challengeId, credential) => {
    setError(null);
    try {
      const response = await authAPI.verifyPasskeyLogin(challengeId, credential);
      const currentUser = applyAuthenticatedPayload(response);
      return {
        success: true,
        status: 'authenticated',
        user: currentUser,
        session_id: response?.session_id || null,
      };
    } catch (err) {
      const message = err.response?.data?.detail || 'Не удалось завершить вход по биометрии';
      setError(message);
      return { success: false, error: message };
    }
  }, [applyAuthenticatedPayload]);

  /**
   * Logout current user
   */
  const logout = useCallback(async () => {
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
        // Always clear local user cache
        localStorage.removeItem('user');
        clearAllMailRecentCache();
        setUser(null);
        window.dispatchEvent(new Event('auth-changed'));
      }
  }, []);

  /**
   * Check if user is authenticated
   */
  const isAuthenticated = useCallback(() => {
    return !!user;
  }, [user]);

  const hasPermission = useCallback((permission) => {
    const target = String(permission || '').trim();
    if (!target) return false;
    if (String(user?.role || '').trim().toLowerCase() === 'admin') {
      return true;
    }
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    return permissions.includes(target);
  }, [user]);

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

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/authApi';
import type { HubUser, LoginResponse } from '../api/types';
import * as tokenStore from './tokenStore';

type AuthContextValue = {
  user: HubUser | null;
  loading: boolean;
  loginChallengeId: string | null;
  /** `setup` when 2FA enrollment must be completed on web first */
  login: (username: string, password: string) => Promise<LoginResponse>;
  verifyTwoFactor: (code: string, isBackup?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function persistLoginResult(result: LoginResponse): Promise<void> {
  const access = String(result.access_token || '').trim();
  const refresh = String(result.refresh_token || '').trim();
  if (result.status === 'authenticated' && access && refresh) {
    await tokenStore.setTokens(access, refresh);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginChallengeId, setLoginChallengeId] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    const me = await authApi.fetchMe();
    setUser(me);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (await tokenStore.hasSession()) {
          await refreshUser();
        }
      } catch {
        await tokenStore.clearTokens();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshUser]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await authApi.login(username, password);
    if (result.status === '2fa_setup_required') {
      setLoginChallengeId('setup');
      return result;
    }
    if (result.status === '2fa_required') {
      setLoginChallengeId(result.login_challenge_id || null);
      return result;
    }
    await persistLoginResult(result);
    setLoginChallengeId(null);
    if (result.user) setUser(result.user);
    else await refreshUser();
    return result;
  }, [refreshUser]);

  const verifyTwoFactor = useCallback(async (code: string, isBackup = false) => {
    if (!loginChallengeId) throw new Error('Missing login challenge');
    const result = await authApi.verifyTwoFactorLogin(loginChallengeId, isBackup
      ? { backup_code: code }
      : { totp_code: code });
    await persistLoginResult(result);
    setLoginChallengeId(null);
    if (result.user) setUser(result.user);
    else await refreshUser();
  }, [loginChallengeId, refreshUser]);

  const logout = useCallback(async () => {
    const refresh = await tokenStore.getRefreshToken();
    try {
      await authApi.logout(refresh);
    } catch {
      // ignore network errors on logout
    }
    await tokenStore.clearTokens();
    setUser(null);
    setLoginChallengeId(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      loginChallengeId,
      login,
      verifyTwoFactor,
      logout,
      refreshUser,
      hasPermission,
    }),
    [user, loading, loginChallengeId, login, verifyTwoFactor, logout, refreshUser, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

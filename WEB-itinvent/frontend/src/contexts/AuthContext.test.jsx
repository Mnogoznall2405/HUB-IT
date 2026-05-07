import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const loginMock = vi.fn();
const verifyTwoFactorLoginMock = vi.fn();
const verifyTrustedDeviceAuthMock = vi.fn();
const clearAllMailRecentCacheMock = vi.fn();
const disableChatPushSubscriptionMock = vi.fn();
const AUTH_VERIFIED_AT_KEY = 'auth_verified_at';

vi.mock('../api/client', () => ({
  AUTH_REFRESH_TIMEOUT_MS: 1500,
  authAPI: {
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    login: (...args) => loginMock(...args),
    verifyTwoFactorLogin: (...args) => verifyTwoFactorLoginMock(...args),
    verifyTrustedDeviceAuth: (...args) => verifyTrustedDeviceAuthMock(...args),
  },
}));

vi.mock('../lib/mailRecentCache', () => ({
  clearAllMailRecentCache: (...args) => clearAllMailRecentCacheMock(...args),
}));

vi.mock('../lib/chatNotifications', () => ({
  disableChatPushSubscription: (...args) => disableChatPushSubscriptionMock(...args),
}));

import { AuthProvider, useAuth } from './AuthContext';

function AuthProbe() {
  const {
    authChecking,
    loading,
    user,
    login,
    refreshSession,
    verifyTrustedDeviceAuth,
    verifyTwoFactorLogin,
  } = useAuth();
  return (
    <>
      <div data-testid="auth-checking">{String(authChecking)}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="username">{user?.username || ''}</div>
      <button type="button" onClick={() => refreshSession({ suppressAuthRequired: true })}>
        refresh
      </button>
      <button type="button" onClick={() => login('user', 'password')}>
        login
      </button>
      <button type="button" onClick={() => verifyTwoFactorLogin('challenge-1', { totp_code: '123456' })}>
        verify-2fa
      </button>
      <button type="button" onClick={() => verifyTrustedDeviceAuth('challenge-1', 'device-1', { id: 'credential' })}>
        verify-device
      </button>
    </>
  );
}

function renderAuth(pathname = '/login') {
  window.history.pushState({}, '', pathname);
  render(
    <AuthProvider>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe('AuthProvider startup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('does not call /auth/me on /login when no user is cached', async () => {
    renderAuth('/login');

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('username')).toHaveTextContent('');
  });

  it('uses a fresh auth verification timestamp to skip startup /auth/me', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    localStorage.setItem(AUTH_VERIFIED_AT_KEY, String(now - 10_000));

    renderAuth('/dashboard');

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cached');
    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toHaveTextContent('false');
    });
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('shows cached user immediately and validates the session in the background', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    let resolveCurrentUser;
    getCurrentUserMock.mockReturnValue(new Promise((resolve) => {
      resolveCurrentUser = resolve;
    }));

    renderAuth('/dashboard');

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cached');

    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true, timeout: 1500 });
    });
    expect(screen.getByTestId('auth-checking')).toHaveTextContent('true');

    resolveCurrentUser({ id: 7, username: 'fresh', role: 'operator' });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('fresh');
    });
    await waitFor(() => {
      expect(screen.getByTestId('auth-checking')).toHaveTextContent('false');
    });
    expect(Number(localStorage.getItem(AUTH_VERIFIED_AT_KEY))).toBeGreaterThan(0);
  });

  it('validates a stale cached user in the background', async () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    localStorage.setItem(AUTH_VERIFIED_AT_KEY, String(now - 61_000));
    getCurrentUserMock.mockResolvedValue({ id: 7, username: 'fresh', role: 'operator' });

    renderAuth('/dashboard');

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cached');
    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true, timeout: 1500 });
    });
  });

  it('keeps refreshSession available for explicit session refreshes', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 3, username: 'manual', role: 'viewer' });

    renderAuth('/login');
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('manual');
    });
    expect(Number(localStorage.getItem(AUTH_VERIFIED_AT_KEY))).toBeGreaterThan(0);
  });

  it('stores the auth verification timestamp after successful interactive auth', async () => {
    const now = 1_700_000_123_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    loginMock.mockResolvedValue({ status: 'authenticated', user: { id: 9, username: 'login-user', role: 'viewer' } });
    verifyTwoFactorLoginMock.mockResolvedValue({ user: { id: 9, username: 'totp-user', role: 'viewer' } });
    verifyTrustedDeviceAuthMock.mockResolvedValue({ user: { id: 9, username: 'device-user', role: 'viewer' } });

    renderAuth('/login');
    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('login-user');
    });
    expect(localStorage.getItem(AUTH_VERIFIED_AT_KEY)).toBe(String(now));

    fireEvent.click(screen.getByRole('button', { name: 'verify-2fa' }));
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('totp-user');
    });
    expect(localStorage.getItem(AUTH_VERIFIED_AT_KEY)).toBe(String(now));

    fireEvent.click(screen.getByRole('button', { name: 'verify-device' }));
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('device-user');
    });
    expect(localStorage.getItem(AUTH_VERIFIED_AT_KEY)).toBe(String(now));
  });

  it('clears the auth verification timestamp when auth is required', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    localStorage.setItem(AUTH_VERIFIED_AT_KEY, String(Date.now()));

    renderAuth('/dashboard');
    act(() => {
      window.dispatchEvent(new Event('auth-required'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('');
    });
    expect(localStorage.getItem(AUTH_VERIFIED_AT_KEY)).toBeNull();
  });
});

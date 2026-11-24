import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression tests for FE-0197 / FE-0198: when a post-auth UI step still has to
// be shown (backup codes after 2FA setup, trusted-device prompt after 2FA
// login), LoginRoute must keep <Login /> mounted even though the user object
// is already committed to the auth state.

const authState = vi.hoisted(() => ({
  user: null,
  loading: false,
  authenticated: false,
  permissions: [],
  postAuthUiHold: false,
}));

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: authState.user,
    loading: authState.loading,
    postAuthUiHold: authState.postAuthUiHold,
    hasPermission: (permission) => authState.permissions.includes(permission),
    isAuthenticated: () => authState.authenticated,
    setPostAuthUiHold: (value) => {
      authState.postAuthUiHold = value;
    },
  }),
}));

vi.mock('./components/chat/ChatSocketBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopNavigationBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopPresenceBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopLifecycleBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopMemoryPressureBootstrap', () => ({ default: () => null }));
vi.mock('./lib/appBadge', () => ({ syncAppBadge: vi.fn(() => Promise.resolve()) }));
vi.mock('./components/layout/MainLayout', () => ({ default: ({ children }) => children }));
vi.mock('./components/layout/MainLayoutRouteShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
vi.mock('./pages/About', () => ({ default: () => <main>Знакомство с HUB-IT</main> }));
vi.mock('./pages/Login', () => ({ default: () => <main data-testid="login-page">Вход в HUB-IT</main> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <main>HUB workspace</main> }));
vi.mock('./pages/SharedFile', () => ({ default: () => <main>Общий файл</main> }));

import App from './App';

const makeUser = () => ({
  id: 7,
  role: 'viewer',
  about_onboarding_completed_at: '2026-08-13T10:00:00Z',
});

describe('LoginRoute post-auth UI hold (FE-0197/FE-0198)', () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    authState.authenticated = false;
    authState.permissions = [];
    authState.postAuthUiHold = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/login');
    window.scrollTo = vi.fn();
  });

  it('keeps Login mounted after the user is committed while the hold is active, then navigates on release', async () => {
    const { rerender } = render(<App />);
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();

    // Mid-flight commit: the auth operation finished (user set) but the
    // post-auth UI (backup codes / trusted-device prompt) is still pending.
    authState.authenticated = true;
    authState.user = makeUser();
    authState.permissions = ['dashboard.read'];
    authState.postAuthUiHold = true;
    await act(async () => {
      rerender(<App />);
    });

    expect(screen.getByTestId('login-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');

    authState.postAuthUiHold = false;
    await act(async () => {
      rerender(<App />);
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard');
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('navigates away from /login immediately after auth when no hold is active', async () => {
    authState.authenticated = true;
    authState.user = makeUser();
    authState.permissions = ['dashboard.read'];
    authState.postAuthUiHold = false;

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard');
    });
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
  });

  it('still shows Login to a guest while the hold is active', async () => {
    authState.postAuthUiHold = true;

    render(<App />);

    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });
});

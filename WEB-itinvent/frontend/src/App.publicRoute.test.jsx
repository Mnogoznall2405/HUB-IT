import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null,
  loading: false,
  authenticated: false,
  permissions: [],
}));

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: authState.user,
    loading: authState.loading,
    hasPermission: (permission) => authState.permissions.includes(permission),
    isAuthenticated: () => authState.authenticated,
  }),
}));

vi.mock('./components/chat/ChatSocketBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopNavigationBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopPresenceBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopLifecycleBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopMemoryPressureBootstrap', () => ({ default: () => null }));
vi.mock('./lib/appBadge', () => ({ syncAppBadge: vi.fn(() => Promise.resolve()) }));
vi.mock('./pages/About', () => ({ default: () => <main>Знакомство с HUB-IT</main> }));
vi.mock('./pages/Login', () => ({ default: () => <main>Вход в HUB-IT</main> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <main>HUB workspace</main> }));
vi.mock('./pages/SharedFile', () => ({ default: () => <main>Общий файл</main> }));

import App from './App';

describe('authenticated onboarding routes', () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
    authState.authenticated = false;
    authState.permissions = [];
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    window.scrollTo = vi.fn();
  });

  it('redirects a guest from the root URL to login', async () => {
    render(<App />);

    expect(await screen.findByText('Вход в HUB-IT')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('opens the workspace from the root URL when the cookie session is active', async () => {
    authState.user = { id: 7, role: 'viewer', about_onboarding_completed_at: '2026-08-13T10:00:00Z' };
    authState.authenticated = true;
    authState.permissions = ['dashboard.read'];

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard');
    });
    expect(await screen.findByText('HUB workspace')).toBeInTheDocument();
  });

  it('keeps workspace routes protected for a guest', async () => {
    window.history.replaceState({}, '', '/tasks');

    render(<App />);

    expect(await screen.findByText('Вход в HUB-IT')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.sessionStorage.getItem('hubit.auth.return-to')).toBe('/tasks');
  });

  it('does not expose the presentation to a guest', async () => {
    window.history.replaceState({}, '', '/about');

    render(<App />);

    expect(await screen.findByText('Вход в HUB-IT')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('opens a shared-file link without login', async () => {
    window.history.replaceState({}, '', '/shared-files/private-token?preview=1');

    render(<App />);

    expect(await screen.findByText('Общий файл')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/shared-files/private-token');
    expect(window.location.search).toBe('?preview=1');
    expect(window.sessionStorage.getItem('hubit.auth.return-to')).toBeNull();
  });

  it('shows onboarding to a newly created user before any workspace route', async () => {
    authState.user = { id: 9, role: 'viewer', about_onboarding_completed_at: null };
    authState.authenticated = true;
    authState.permissions = ['dashboard.read'];
    window.history.replaceState({}, '', '/tasks');

    render(<App />);

    expect(await screen.findByText('Знакомство с HUB-IT')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/about');
    expect(window.sessionStorage.getItem('hubit.auth.return-to')).toBe('/tasks');
  });

  it('treats an absent onboarding field as completed for mixed-version compatibility', async () => {
    authState.user = { id: 7, role: 'viewer' };
    authState.authenticated = true;
    authState.permissions = ['dashboard.read'];

    render(<App />);

    expect(await screen.findByText('HUB workspace')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('continues an active cookie session from login to the stored internal route', async () => {
    authState.user = { id: 7, role: 'viewer', about_onboarding_completed_at: '2026-08-13T10:00:00Z' };
    authState.authenticated = true;
    authState.permissions = ['dashboard.read'];
    window.sessionStorage.setItem('hubit.auth.return-to', '/dashboard?view=mine');
    window.history.replaceState({}, '', '/login');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/dashboard');
      expect(window.location.search).toBe('?view=mine');
    });
    expect(window.sessionStorage.getItem('hubit.auth.return-to')).toBeNull();
  });
});

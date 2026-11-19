import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  authState: {
    user: null,
    loading: false,
    authenticated: false,
    permissions: [],
  },
  shell: { mounts: 0, unmounts: 0 },
}));

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({
    user: harness.authState.user,
    loading: harness.authState.loading,
    hasPermission: (permission) => harness.authState.permissions.includes(permission),
    isAuthenticated: () => harness.authState.authenticated,
  }),
}));

vi.mock('./components/chat/ChatSocketBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopNavigationBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopPresenceBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopLifecycleBootstrap', () => ({ default: () => null }));
vi.mock('./components/layout/DesktopMemoryPressureBootstrap', () => ({ default: () => null }));
vi.mock('./lib/appBadge', () => ({ syncAppBadge: vi.fn(() => Promise.resolve()) }));

vi.mock('./components/layout/MainLayoutRouteShell', async () => {
  const { useEffect, useState } = await import('react');
  const { Outlet } = await import('react-router-dom');
  return {
    default: function SharedShellProbe() {
      const [marker, setMarker] = useState(0);
      useEffect(() => {
        harness.shell.mounts += 1;
        return () => { harness.shell.unmounts += 1; };
      }, []);
      return (
        <div data-testid="hub-shell" data-marker={marker}>
          <button type="button" data-testid="shell-bump" onClick={() => setMarker((value) => value + 1)}>bump</button>
          <Outlet />
        </div>
      );
    },
  };
});

vi.mock('./pages/Dashboard', () => ({ default: () => <main data-testid="page-dashboard">dashboard page</main> }));
vi.mock('./pages/Feed', () => ({ default: () => <main data-testid="page-feed">feed page</main> }));
vi.mock('./pages/Tickets', () => ({ default: () => <main data-testid="page-tickets">tickets page</main> }));
vi.mock('./pages/Tasks', () => ({ default: () => <main data-testid="page-tasks">tasks page</main> }));
vi.mock('./pages/Settings', () => ({ default: () => <main data-testid="page-settings">settings page</main> }));
vi.mock('./pages/About', () => ({ default: () => <main data-testid="page-about">about</main> }));
vi.mock('./pages/Login', () => ({ default: () => <main>login screen</main> }));

import App from './App';

function spaNavigate(path) {
  act(() => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('grouped hub route layout', () => {
  beforeEach(() => {
    harness.authState.user = null;
    harness.authState.loading = false;
    harness.authState.authenticated = false;
    harness.authState.permissions = [];
    harness.shell.mounts = 0;
    harness.shell.unmounts = 0;
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    window.scrollTo = vi.fn();
  });

  it('keeps one shared layout mounted across the grouped routes and unmounts it when leaving the group', async () => {
    harness.authState.user = { id: 7, role: 'user', about_onboarding_completed_at: '2026-08-13T10:00:00Z' };
    harness.authState.authenticated = true;
    harness.authState.permissions = ['dashboard.read', 'tickets.read', 'tasks.read'];
    window.history.replaceState({}, '', '/dashboard');

    render(<App />);

    expect(await screen.findByTestId('page-dashboard')).toBeInTheDocument();
    const shell = screen.getByTestId('hub-shell');
    expect(harness.shell.mounts).toBe(1);
    expect(harness.shell.unmounts).toBe(0);

    fireEvent.click(screen.getByTestId('shell-bump'));
    expect(shell).toHaveAttribute('data-marker', '1');

    spaNavigate('/feed');
    expect(await screen.findByTestId('page-feed')).toBeInTheDocument();
    expect(harness.shell.mounts).toBe(1);
    expect(harness.shell.unmounts).toBe(0);
    expect(screen.getByTestId('hub-shell')).toHaveAttribute('data-marker', '1');

    spaNavigate('/tickets');
    expect(await screen.findByTestId('page-tickets')).toBeInTheDocument();
    expect(harness.shell.mounts).toBe(1);
    expect(harness.shell.unmounts).toBe(0);
    expect(screen.getByTestId('hub-shell')).toHaveAttribute('data-marker', '1');

    spaNavigate('/tasks');
    expect(await screen.findByTestId('page-tasks')).toBeInTheDocument();
    expect(harness.shell.mounts).toBe(1);
    expect(harness.shell.unmounts).toBe(0);
    expect(screen.getByTestId('hub-shell')).toHaveAttribute('data-marker', '1');

    spaNavigate('/settings');
    expect(await screen.findByTestId('page-settings')).toBeInTheDocument();
    expect(harness.shell.mounts).toBe(1);
    expect(harness.shell.unmounts).toBe(0);
    expect(screen.getByTestId('hub-shell')).toHaveAttribute('data-marker', '1');

    spaNavigate('/about');
    expect(await screen.findByTestId('page-about')).toBeInTheDocument();
    expect(harness.shell.unmounts).toBe(1);
    expect(screen.queryByTestId('hub-shell')).toBeNull();
  });

  it('still redirects a grouped route without the required permission', async () => {
    harness.authState.user = { id: 7, role: 'user', about_onboarding_completed_at: '2026-08-13T10:00:00Z' };
    harness.authState.authenticated = true;
    harness.authState.permissions = ['dashboard.read', 'tasks.read'];
    window.history.replaceState({}, '', '/tickets');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).not.toBe('/tickets'));
    expect(screen.queryByTestId('page-tickets')).toBeNull();
    expect(await screen.findByTestId('page-dashboard')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const clearAllMailRecentCacheMock = vi.fn();
const disableChatPushSubscriptionMock = vi.fn();
const clearMobileOfflineCacheMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('../api/client', () => ({
  authAPI: {
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    logout: (...args) => logoutMock(...args),
  },
}));

vi.mock('../lib/mailRecentCache', () => ({
  clearAllMailRecentCache: (...args) => clearAllMailRecentCacheMock(...args),
}));

vi.mock('../lib/chatNotifications', () => ({
  disableChatPushSubscription: (...args) => disableChatPushSubscriptionMock(...args),
}));

vi.mock('../lib/mobileOfflineCache', () => ({
  clearMobileOfflineCache: (...args) => clearMobileOfflineCacheMock(...args),
}));

import { AuthProvider, useAuth } from './AuthContext';

function AuthProbe() {
  const { loading, user, logout, refreshSession, hasPermission } = useAuth();
  return (
    <>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="username">{user?.username || ''}</div>
      <div data-testid="can-dashboard">{String(hasPermission('dashboard.read'))}</div>
      <div data-testid="can-task-create">{String(hasPermission('tasks.create'))}</div>
      <div data-testid="can-tickets">{String(hasPermission('tickets.read'))}</div>
      <div data-testid="can-address-book">{String(hasPermission('address_book.read'))}</div>
      <div data-testid="can-address-book-hire-date">{String(hasPermission('address_book.hire_date.read'))}</div>
      <div data-testid="can-chat-read">{String(hasPermission('chat.read'))}</div>
      <div data-testid="can-chat-write">{String(hasPermission('chat.write'))}</div>
      <div data-testid="can-ai-sandbox">{String(hasPermission('chat.ai.sandbox'))}</div>
      <button type="button" onClick={() => refreshSession({ suppressAuthRequired: true })}>
        refresh
      </button>
      <button type="button" onClick={() => logout()}>
        logout
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
    vi.clearAllMocks();
    logoutMock.mockResolvedValue({ ok: true });
    disableChatPushSubscriptionMock.mockResolvedValue(undefined);
    clearMobileOfflineCacheMock.mockResolvedValue(0);
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('restores an active cookie session on /login even when no user is cached', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 12, username: 'trusted-device-user', role: 'viewer' });
    renderAuth('/login');

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
    expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    expect(screen.getByTestId('username')).toHaveTextContent('trusted-device-user');
  });

  it('shows cached user immediately and validates the session in the background', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    getCurrentUserMock.mockResolvedValue({ id: 7, username: 'fresh', role: 'operator' });

    renderAuth('/dashboard');

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cached');

    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('fresh');
    });
  });

  it('keeps the cached session during a startup network failure and recovers when online', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    getCurrentUserMock
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
      .mockResolvedValueOnce({ id: 7, username: 'fresh', role: 'operator' });

    renderAuth('/dashboard');

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('username')).toHaveTextContent('cached');
    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('username')).toHaveTextContent('cached');
    expect(JSON.parse(localStorage.getItem('user'))?.username).toBe('cached');

    fireEvent(window, new Event('online'));

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('fresh');
    });
  });

  it('keeps startup pending without cached user until the network recovers', async () => {
    getCurrentUserMock
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }))
      .mockResolvedValueOnce({ id: 12, username: 'restored', role: 'viewer' });

    renderAuth('/login');

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('username')).toHaveTextContent('');

    fireEvent(window, new Event('online'));

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('username')).toHaveTextContent('restored');
    });
  });

  it('clears a cached user after a definitive unauthorized response', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    getCurrentUserMock.mockRejectedValue({
      response: { status: 401 },
      message: 'Request failed with status code 401',
    });

    renderAuth('/dashboard');

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('');
    });
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('keeps refreshSession available for explicit session refreshes', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 3, username: 'manual', role: 'viewer' });

    renderAuth('/login');
    screen.getByRole('button', { name: 'refresh' }).click();

    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('manual');
    });
  });

  it('single-flights overlapping refreshSession and online recovery', async () => {
    let resolveUser;
    getCurrentUserMock.mockImplementation(() => new Promise((resolve) => {
      resolveUser = resolve;
    }));
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    renderAuth('/dashboard');

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('online'));
    fireEvent(window, new Event('focus'));
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);

    resolveUser({ id: 7, username: 'fresh', role: 'operator' });
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('fresh');
    });
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
  });

  it('applies logout from another HUB window immediately', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'shared', role: 'operator' }));
    getCurrentUserMock.mockResolvedValue({ id: 7, username: 'shared', role: 'operator' });
    renderAuth('/dashboard');

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('shared'));

    localStorage.removeItem('user');
    fireEvent(window, new StorageEvent('storage', {
      key: 'user',
      oldValue: JSON.stringify({ id: 7, username: 'shared', role: 'operator' }),
      newValue: null,
    }));

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent(''));
  });

  it('verifies login from another HUB window through the protected session endpoint', async () => {
    getCurrentUserMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 15, username: 'verified-shared', role: 'viewer' });
    renderAuth('/login');

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));

    const announcedUser = JSON.stringify({ id: 15, username: 'untrusted-cache', role: 'viewer' });
    localStorage.setItem('user', announcedUser);
    fireEvent(window, new StorageEvent('storage', {
      key: 'user',
      oldValue: null,
      newValue: announcedUser,
    }));

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('verified-shared');
    });
  });

  it('does not grant tickets access from the operator fallback permissions', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 8, username: 'operator', role: 'operator' });

    renderAuth('/dashboard');

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('operator');
    });
    expect(screen.getByTestId('can-dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('can-task-create')).toHaveTextContent('true');
    expect(screen.getByTestId('can-tickets')).toHaveTextContent('false');
    expect(screen.getByTestId('can-ai-sandbox')).toHaveTextContent('false');
  });

  it('does not grant tickets access from the viewer fallback permissions', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 9, username: 'viewer', role: 'viewer' });

    renderAuth('/dashboard');

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('viewer');
    });
    expect(screen.getByTestId('can-dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('can-task-create')).toHaveTextContent('true');
    expect(screen.getByTestId('can-tickets')).toHaveTextContent('false');
    expect(screen.getByTestId('can-address-book')).toHaveTextContent('true');
    expect(screen.getByTestId('can-address-book-hire-date')).toHaveTextContent('false');
    expect(screen.getByTestId('can-ai-sandbox')).toHaveTextContent('false');
  });

  it('grants sandbox access through the admin fallback', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 11, username: 'admin', role: 'admin' });
    renderAuth('/dashboard');

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('admin'));
    expect(screen.getByTestId('can-ai-sandbox')).toHaveTextContent('true');
    expect(screen.getByTestId('can-address-book-hire-date')).toHaveTextContent('true');
  });

  it('grants sandbox access to a pilot user with an explicit server permission', async () => {
    getCurrentUserMock.mockResolvedValue({
      id: 12,
      username: 'pilot',
      role: 'viewer',
      permissions: ['chat.ai.use', 'chat.ai.sandbox'],
    });
    renderAuth('/dashboard');

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('pilot'));
    expect(screen.getByTestId('can-ai-sandbox')).toHaveTextContent('true');
  });

  it('keeps the current username for the next login after logout', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'ivanov', role: 'operator' }));
    getCurrentUserMock.mockResolvedValue({ id: 7, username: 'ivanov', role: 'operator' });
    renderAuth('/dashboard');
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('ivanov'));

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => {
      expect(localStorage.getItem('hubit.login.last-username')).toBe('ivanov');
    });
    expect(localStorage.getItem('user')).toBeNull();
    expect(clearMobileOfflineCacheMock).toHaveBeenCalledTimes(1);
  });

  it('always grants basic address-book and chat access when the server permission list is empty', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 10, username: 'custom', role: 'viewer', permissions: [] });

    renderAuth('/dashboard');

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('custom');
    });
    expect(screen.getByTestId('can-address-book')).toHaveTextContent('true');
    expect(screen.getByTestId('can-chat-read')).toHaveTextContent('true');
    expect(screen.getByTestId('can-chat-write')).toHaveTextContent('true');
  });
});

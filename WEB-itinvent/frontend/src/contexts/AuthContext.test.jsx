import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const clearAllMailRecentCacheMock = vi.fn();
const disableChatPushSubscriptionMock = vi.fn();
const clearMobileOfflineCacheMock = vi.fn();
const logoutMock = vi.fn();
const loginMock = vi.fn();

vi.mock('../api/client', () => ({
  authAPI: {
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    logout: (...args) => logoutMock(...args),
    login: (...args) => loginMock(...args),
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
import { clearSWRCache, peekSWRCache, setSWRCache } from '../lib/swrCache';

function AuthProbe() {
  const { loading, user, logout, refreshSession, hasPermission, login } = useAuth();
  const [loginResult, setLoginResult] = React.useState('');
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
      <button type="button" onClick={async () => { const result = await login('ivanov', 'pw'); setLoginResult(String(result.error)); }}>
        login
      </button>
      <div data-testid="login-error">{loginResult}</div>
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
    clearSWRCache();
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

  it('restores cached user before the background session check completes', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));
    let resolveSession;
    getCurrentUserMock.mockImplementation(() => new Promise((resolve) => { resolveSession = resolve; }));

    renderAuth('/dashboard');

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('cached'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    await waitFor(() => {
      expect(getCurrentUserMock).toHaveBeenCalledWith({ suppressAuthRequired: true });
    });
    await act(async () => resolveSession({ id: 7, username: 'fresh', role: 'operator' }));
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

    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('cached'));
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

  it('finishes anonymous startup after a definitive session rejection', async () => {
    getCurrentUserMock.mockRejectedValue({ response: { status: 401, data: { detail: 'Session expired' } } });
    renderAuth('/login');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toBeEmptyDOMElement();
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

  it('does not reuse a previous account check after a shared-window login', async () => {
    let resolveOld;
    getCurrentUserMock.mockResolvedValueOnce({ id: 7, username: 'user-a', role: 'viewer' })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ id: 8, username: 'verified-user-b', role: 'viewer' });
    renderAuth('/login');
    await screen.findByText('user-a');
    setSWRCache('private-cache', 'user-A');
    fireEvent.click(screen.getByRole('button', { name: 'refresh', exact: true }));
    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(2));
    const announced = JSON.stringify({ id: 8, username: 'untrusted-user-b', role: 'admin' });
    localStorage.setItem('user', announced);
    fireEvent(window, new StorageEvent('storage', { key: 'user', newValue: announced }));
    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(3));
    await screen.findByText('verified-user-b');
    await act(async () => { resolveOld({ id: 7, username: 'old-user-a', role: 'viewer' }); });
    expect(screen.getByTestId('username')).toHaveTextContent('verified-user-b');
    expect(peekSWRCache('private-cache')).toBeNull();
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

  it('does not restore a logged-out session from a late refresh response', async () => {
    let resolveRefresh;
    getCurrentUserMock.mockResolvedValueOnce({ id: 7, username: 'user-a', role: 'viewer' })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    renderAuth('/login');
    await screen.findByText('user-a');
    setSWRCache('private-cache', 'user-A');
    fireEvent.click(screen.getByRole('button', { name: 'refresh', exact: true }));
    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'logout', exact: true }));
    await waitFor(() => expect(screen.getByTestId('username')).toBeEmptyDOMElement());
    await act(async () => { resolveRefresh({ id: 7, username: 'late-user-a', role: 'viewer' }); });
    await waitFor(() => expect(localStorage.getItem('user')).toBeNull());
    expect(screen.getByTestId('username')).toBeEmptyDOMElement();
    expect(peekSWRCache('private-cache')).toBeNull();
  });

  it('clears shared SWR entries when the verified session changes account', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 7, username: 'user-a', role: 'viewer' })
      .mockResolvedValueOnce({ id: 8, username: 'user-b', role: 'viewer' });
    renderAuth('/login');
    await screen.findByText('user-a');
    setSWRCache('private-cache', 'user-A');
    fireEvent.click(screen.getByRole('button', { name: 'refresh', exact: true }));
    await screen.findByText('user-b');
    expect(peekSWRCache('private-cache')).toBeNull();
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

  it('always grants the viewer baseline when the server permission list is empty', async () => {
    getCurrentUserMock.mockResolvedValue({ id: 10, username: 'custom', role: 'viewer', permissions: [] });

    renderAuth('/dashboard');

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('custom');
    });
    expect(screen.getByTestId('can-address-book')).toHaveTextContent('true');
    expect(screen.getByTestId('can-chat-read')).toHaveTextContent('true');
    expect(screen.getByTestId('can-chat-write')).toHaveTextContent('true');
    expect(screen.getByTestId('can-dashboard')).toHaveTextContent('true');
    expect(screen.getByTestId('can-task-create')).toHaveTextContent('true');
  });

  it('turns a FastAPI 422 detail array into a plain login error message', async () => {
    getCurrentUserMock.mockRejectedValue({ response: { status: 401 } });
    loginMock.mockRejectedValue({
      response: { status: 422, data: { detail: [{ loc: ['body', 'username'], msg: 'Поле обязательно' }] } },
    });
    renderAuth('/login');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('Поле обязательно'));
  });
});

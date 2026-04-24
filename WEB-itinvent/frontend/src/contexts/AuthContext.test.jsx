import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();
const clearAllMailRecentCacheMock = vi.fn();
const disableChatPushSubscriptionMock = vi.fn();

vi.mock('../api/client', () => ({
  authAPI: {
    getCurrentUser: (...args) => getCurrentUserMock(...args),
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
  const { loading, user, refreshSession } = useAuth();
  return (
    <>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="username">{user?.username || ''}</div>
      <button type="button" onClick={() => refreshSession({ suppressAuthRequired: true })}>
        refresh
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
});

import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppPushBootstrap } from './App';

const {
  authState,
  disablePushMock,
  getPushStateMock,
  refreshPushStateMock,
  requestPushDrainMock,
  syncPushMock,
} = vi.hoisted(() => ({
  authState: {
    user: { id: 8, username: 'mobile-user' },
    allowedPermissions: new Set(['tasks.read']),
  },
  disablePushMock: vi.fn(),
  getPushStateMock: vi.fn(),
  refreshPushStateMock: vi.fn(),
  requestPushDrainMock: vi.fn(),
  syncPushMock: vi.fn(),
}));

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
    hasPermission: (permission) => authState.allowedPermissions.has(permission),
  }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('./lib/chatNotifications', () => ({
  applyChatPushDiagnostic: vi.fn(),
  disableChatPushSubscription: disablePushMock,
  getChatNotificationState: getPushStateMock,
  refreshChatNotificationState: refreshPushStateMock,
  requestChatPushSyncDrain: requestPushDrainMock,
  syncChatPushSubscription: syncPushMock,
}));

vi.mock('./lib/appBadge', () => ({
  syncAppBadge: vi.fn(),
}));

describe('AppPushBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 8, username: 'mobile-user' };
    authState.allowedPermissions = new Set(['tasks.read']);
    getPushStateMock.mockReturnValue({
      enabled: true,
      permission: 'default',
      pushSubscribed: false,
      pendingResubscribe: false,
    });
    syncPushMock.mockResolvedValue({ pushSubscribed: false });
    disablePushMock.mockResolvedValue({ pushSubscribed: false });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
  });

  it('does not destroy the browser push subscription while auth is still hydrating', async () => {
    authState.user = null;

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <AppPushBootstrap />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getPushStateMock).toHaveBeenCalled();
    });

    expect(disablePushMock).not.toHaveBeenCalled();
    expect(syncPushMock).not.toHaveBeenCalled();
  });

  it('immediately resyncs the shared push subscription after notification permission is granted', async () => {
    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <AppPushBootstrap />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(syncPushMock).toHaveBeenCalledTimes(1);
    });

    getPushStateMock.mockReturnValue({
      enabled: true,
      permission: 'granted',
      pushSubscribed: false,
      pendingResubscribe: false,
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('itinvent:windows-notifications-changed'));
    });

    await waitFor(() => {
      expect(syncPushMock).toHaveBeenCalledTimes(2);
    });
  });

  it('retries app-wide push even when the local chat-notification toggle is off', async () => {
    vi.useFakeTimers();
    getPushStateMock.mockReturnValue({
      enabled: false,
      permission: 'granted',
      pushSubscribed: false,
      pendingResubscribe: false,
    });

    render(
      <MemoryRouter initialEntries={['/tasks']}>
        <AppPushBootstrap />
      </MemoryRouter>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(syncPushMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('hard-assigns chat targets from notification clicks instead of soft SPA navigate', async () => {
    const assignMock = vi.fn();
    const originalLocation = window.location;
    const messageListeners = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
        addEventListener: vi.fn((type, handler) => {
          if (type === 'message') messageListeners.push(handler);
        }),
        removeEventListener: vi.fn((type, handler) => {
          if (type !== 'message') return;
          const index = messageListeners.indexOf(handler);
          if (index >= 0) messageListeners.splice(index, 1);
        }),
      },
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        origin: 'https://hub.example',
        pathname: '/dashboard',
        search: '',
        hash: '',
        assign: assignMock,
      },
    });

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppPushBootstrap />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(messageListeners.length).toBeGreaterThan(0);
    });

    act(() => {
      messageListeners.forEach((listener) => {
        listener({
          data: {
            type: 'itinvent:navigate',
            route: '/chat?conversation=7&message=m1',
            source: 'notificationclick',
          },
        });
      });
    });

    expect(assignMock).toHaveBeenCalledWith('/chat?conversation=7&message=m1');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserNotificationsSettingsCard, ChatNotificationsSettingsCard } from './Settings';
import {
  WINDOWS_NOTIFICATIONS_ENABLED_KEY,
  WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY,
} from '../lib/windowsNotifications';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin' },
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifyInfo: vi.fn(),
    notifySuccess: vi.fn(),
    notifyWarning: vi.fn(),
  }),
}));

describe('BrowserNotificationsSettingsCard', () => {
  let notificationPermission = 'default';

  beforeEach(() => {
    window.localStorage.clear();
    notificationPermission = 'default';

    class MockNotification {}

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => notificationPermission,
    });

    MockNotification.requestPermission = vi.fn(async () => {
      notificationPermission = 'granted';
      return 'granted';
    });

    window.Notification = MockNotification;
  });

  it('shows permission request flow and stores the local toggle', async () => {
    render(<BrowserNotificationsSettingsCard />);

    expect(screen.getByText('Windows-уведомления')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Разрешить уведомления' })).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox');
    fireEvent.click(toggle);
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_ENABLED_KEY)).toBe('1');
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY)).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Разрешить уведомления' }));

    await waitFor(() => {
      expect(screen.getByText('Разрешено')).toBeInTheDocument();
    });
    expect(window.localStorage.getItem(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY)).toBe('1');
    expect(screen.getByText(/Системные уведомления разрешены/i)).toBeInTheDocument();
  });
});

describe('ChatNotificationsSettingsCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows Yandex Browser as foreground-only even with granted permission', async () => {
    class MockNotification {}

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });

    MockNotification.requestPermission = vi.fn(async () => 'granted');
    window.Notification = MockNotification;

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe: vi.fn(),
          },
        }),
      },
    });
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 YaBrowser/24.12.0.0 Mobile Safari/537.36',
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux armv8l',
    });
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const client = await import('../api/client');
    vi.spyOn(client.chatAPI, 'getPushConfig').mockResolvedValue({
      enabled: true,
      vapid_public_key: 'SGVsbG8',
      requires_installed_pwa: true,
      icon_url: '/pwa-192.png',
      badge_url: '/hubit-badge.svg',
    });

    render(<ChatNotificationsSettingsCard />);

    await waitFor(() => {
      expect(screen.getByText(/Яндекс\.Браузере chat-уведомления поддерживаются только из открытой вкладки/i)).toBeInTheDocument();
    });
  });
});

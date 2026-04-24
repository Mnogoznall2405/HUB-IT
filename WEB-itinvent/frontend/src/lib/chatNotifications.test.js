import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetPushConfig,
  mockUpsertPushSubscription,
  mockDeletePushSubscription,
  mockGetBrowserNotificationPermission,
  mockIsBrowserNotificationSupported,
  mockRequestBrowserNotificationPermission,
} = vi.hoisted(() => ({
  mockGetPushConfig: vi.fn(),
  mockUpsertPushSubscription: vi.fn(),
  mockDeletePushSubscription: vi.fn(),
  mockGetBrowserNotificationPermission: vi.fn(),
  mockIsBrowserNotificationSupported: vi.fn(),
  mockRequestBrowserNotificationPermission: vi.fn(),
}));

vi.mock('../api/client', () => ({
  settingsAPI: {
    getNotificationPushConfig: mockGetPushConfig,
    upsertNotificationPushSubscription: mockUpsertPushSubscription,
    deleteNotificationPushSubscription: mockDeletePushSubscription,
  },
}));

vi.mock('./windowsNotifications', () => ({
  getBrowserNotificationPermission: mockGetBrowserNotificationPermission,
  isBrowserNotificationSupported: mockIsBrowserNotificationSupported,
  requestBrowserNotificationPermission: mockRequestBrowserNotificationPermission,
}));

describe('chatNotifications', () => {
  let notificationInstances;
  let mockGetSubscription;
  let mockSubscribe;
  let mockUnsubscribe;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    notificationInstances = [];
    mockGetPushConfig.mockReset();
    mockUpsertPushSubscription.mockReset();
    mockDeletePushSubscription.mockReset();
    mockGetBrowserNotificationPermission.mockReset();
    mockIsBrowserNotificationSupported.mockReset();
    mockRequestBrowserNotificationPermission.mockReset();

    mockGetBrowserNotificationPermission.mockReturnValue('granted');
    mockIsBrowserNotificationSupported.mockReturnValue(true);
    mockRequestBrowserNotificationPermission.mockResolvedValue('granted');
    mockGetPushConfig.mockResolvedValue({
      enabled: true,
      vapid_public_key: 'SGVsbG8',
      requires_installed_pwa: true,
      icon_url: '/pwa-192.png',
      badge_url: '/hubit-badge.svg',
    });
    mockUpsertPushSubscription.mockResolvedValue({ ok: true, subscribed: true, push_enabled: true });
    mockDeletePushSubscription.mockResolvedValue({ ok: true, subscribed: false, push_enabled: true });

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    });
    window.focus = vi.fn();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Chrome/135.0.0.0 Safari/537.36',
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
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

    class MockNotification {
      constructor(title, options) {
        this.title = title;
        this.options = options;
        this.onclick = null;
        this.close = vi.fn();
        notificationInstances.push(this);
      }
    }

    Object.defineProperty(MockNotification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });

    window.Notification = MockNotification;

    mockGetSubscription = vi.fn().mockResolvedValue(null);
    mockUnsubscribe = vi.fn().mockResolvedValue(true);
    mockSubscribe = vi.fn().mockResolvedValue({
      endpoint: 'https://push.example/sub',
      unsubscribe: mockUnsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example/sub',
        expirationTime: null,
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-key',
        },
      }),
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: mockGetSubscription,
            subscribe: mockSubscribe,
          },
        }),
      },
    });
  });

  it('deduplicates foreground browser notifications per message and deep-links on click', async () => {
    const { createChatSystemNotification } = await import('./chatNotifications');
    const onNavigate = vi.fn();

    const first = createChatSystemNotification({
      messageId: 'msg-1',
      title: 'Sender',
      body: 'Preview body',
      conversationId: 'conv-1',
      onNavigate,
    });
    const second = createChatSystemNotification({
      messageId: 'msg-1',
      title: 'Sender',
      body: 'Preview body',
      conversationId: 'conv-1',
      onNavigate,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(notificationInstances).toHaveLength(1);

    first.onclick?.();
    expect(onNavigate).toHaveBeenCalledWith('/chat?conversation=conv-1&message=msg-1');
  });

  it('subscribes the current browser for background chat push when supported', async () => {
    const { syncChatPushSubscription } = await import('./chatNotifications');

    const snapshot = await syncChatPushSubscription({
      user: { id: 1, username: 'admin' },
    });

    expect(mockGetPushConfig).toHaveBeenCalledTimes(1);
    expect(mockGetSubscription).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUpsertPushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example/sub',
      expiration_time: null,
      p256dh_key: 'p256dh-key',
      auth_key: 'auth-key',
      platform: 'Win32',
      browser_family: 'chrome',
      install_mode: 'browser',
    });
    expect(snapshot.pushSubscribed).toBe(true);
    expect(snapshot.backgroundCapable).toBe(true);
  });

  it('reuses an existing Android push subscription instead of rotating endpoints on each app session', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36',
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux armv81',
    });
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const existingUnsubscribe = vi.fn().mockResolvedValue(true);
    const existingSubscription = {
      endpoint: 'https://push.example/old-sub',
      unsubscribe: existingUnsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example/old-sub',
        expirationTime: null,
        keys: {
          p256dh: 'old-p256dh',
          auth: 'old-auth',
        },
      }),
    };
    mockGetSubscription.mockResolvedValue(existingSubscription);

    const { syncChatPushSubscription } = await import('./chatNotifications');

    const snapshot = await syncChatPushSubscription({
      user: { id: 1, username: 'admin' },
    });

    expect(existingUnsubscribe).not.toHaveBeenCalled();
    expect(mockDeletePushSubscription).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockUpsertPushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example/old-sub',
      expiration_time: null,
      p256dh_key: 'old-p256dh',
      auth_key: 'old-auth',
      platform: 'Linux armv81',
      browser_family: 'chrome',
      install_mode: 'standalone',
    });
    expect(snapshot.pushSubscribed).toBe(true);
  });

  it('keeps Yandex Browser in foreground-only mode without creating a push subscription', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 YaBrowser/24.12.0.0 Mobile Safari/537.36',
    });

    const { syncChatPushSubscription } = await import('./chatNotifications');

    const snapshot = await syncChatPushSubscription({
      user: { id: 1, username: 'admin' },
    });

    expect(mockGetPushConfig).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockUpsertPushSubscription).not.toHaveBeenCalled();
    expect(snapshot.pushConfigured).toBe(true);
    expect(snapshot.pushSubscribed).toBe(false);
    expect(snapshot.pushBlockedByBrowserPolicy).toBe(true);
    expect(snapshot.foregroundOnlyReason).toBe('yandex_limited');
    expect(snapshot.backgroundCapable).toBe(false);
  });

  it('reports missing server push configuration separately from browser policy', async () => {
    mockGetPushConfig.mockResolvedValue({
      enabled: false,
      vapid_public_key: null,
      requires_installed_pwa: true,
      icon_url: '/pwa-192.png',
      badge_url: '/hubit-badge.svg',
    });

    const { syncChatPushSubscription } = await import('./chatNotifications');

    const snapshot = await syncChatPushSubscription({
      user: { id: 1, username: 'admin' },
    });

    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(snapshot.pushConfigured).toBe(false);
    expect(snapshot.pushSubscribed).toBe(false);
    expect(snapshot.foregroundOnlyReason).toBe('server_not_configured');
  });

  it('tracks websocket outages as a foreground diagnostic state', async () => {
    const { getChatNotificationState, setChatSocketStatus } = await import('./chatNotifications');

    setChatSocketStatus('disconnected');

    expect(getChatNotificationState().foregroundDiagnostic).toBe('chat_socket_unavailable');
  });
});

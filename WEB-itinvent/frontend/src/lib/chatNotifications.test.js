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
    delete window.chrome;
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

    expect(first).toEqual(expect.objectContaining({ queued: true, messageId: 'msg-1' }));
    expect(second).toBeNull();
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.tag).toBe('chat:msg:msg-1');

    notificationInstances[0].onclick?.();
    expect(onNavigate).toHaveBeenCalledWith('/chat?conversation=conv-1&message=msg-1');
  });

  it('routes foreground notifications to the native desktop bridge without browser duplicates', async () => {
    const listeners = new Set();
    const transport = {
      addEventListener: vi.fn((type, listener) => {
        if (type === 'message') listeners.add(listener);
      }),
      postMessage: vi.fn(),
    };
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: transport },
    });

    const { initializeDesktopBridge } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    listeners.forEach((listener) => listener({
      data: {
        type: 'desktop.hostReady',
        version: 1,
        capabilities: { notifications: true },
      },
    }));
    await initialization;

    const { createChatSystemNotification } = await import('./chatNotifications');
    const result = createChatSystemNotification({
      messageId: 'msg-42',
      title: 'Иван\nПетров',
      body: 'Новое\nсообщение',
      conversationId: 'conv-7',
    });

    expect(result).toEqual({ queued: false, native: true, messageId: 'msg-42' });
    expect(notificationInstances).toHaveLength(0);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'notification.show',
      version: 1,
      id: 'chat:msg:msg-42',
      title: 'Иван Петров',
      body: 'Новое сообщение',
      route: '/chat?conversation=conv-7&message=msg-42',
    });
  });

  it('prefers external push delivery when subscribed or background-capable', async () => {
    const { shouldDeliverExternalChatViaPushOnly } = await import('./chatNotifications');

    expect(shouldDeliverExternalChatViaPushOnly({ pushSubscribed: false, backgroundCapable: false })).toBe(false);
    expect(shouldDeliverExternalChatViaPushOnly({ pushSubscribed: true, backgroundCapable: false })).toBe(true);
    expect(shouldDeliverExternalChatViaPushOnly({ pushSubscribed: false, backgroundCapable: true })).toBe(true);
  });

  it('resolveChatNotificationSenderName rejects lean user-N stubs', async () => {
    const { resolveChatNotificationSenderName } = await import('./chatNotifications');
    expect(resolveChatNotificationSenderName({
      sender: { full_name: null, username: 'user-38' },
    })).toBe('Собеседник');
    expect(resolveChatNotificationSenderName({
      sender: { full_name: 'Иван Иванов', username: 'user-38' },
    })).toBe('Иван Иванов');
    expect(resolveChatNotificationSenderName({
      sender: { full_name: null, username: 'ivan.petrov' },
    })).toBe('ivan.petrov');
  });

  it('syncs the visible active conversation to the service worker for push suppression', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ active: { postMessage } }),
        controller: { postMessage },
      },
    });
    const { syncActiveChatConversationToServiceWorker } = await import('./chatNotifications');

    syncActiveChatConversationToServiceWorker('conv-7');
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'itinvent:active-chat-conversation',
      conversationId: 'conv-7',
      visible: true,
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    syncActiveChatConversationToServiceWorker('conv-7');
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'itinvent:active-chat-conversation',
      conversationId: '',
      visible: false,
    });
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

  it('records browser subscription failures and allows a later retry', async () => {
    const subscriptionError = new Error('Browser rejected push subscription');
    subscriptionError.name = 'NotAllowedError';
    mockSubscribe.mockRejectedValueOnce(subscriptionError);
    const { getChatNotificationState, syncChatPushSubscription } = await import('./chatNotifications');

    await expect(syncChatPushSubscription({ user: { id: 1 } })).rejects.toThrow(
      'Browser rejected push subscription',
    );
    expect(getChatNotificationState()).toEqual(expect.objectContaining({
      pushSubscribed: false,
      lastError: 'NotAllowedError',
    }));

    const snapshot = await syncChatPushSubscription({ user: { id: 1 } });
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(snapshot.pushSubscribed).toBe(true);
    expect(snapshot.lastError).toBe('');
  });

  it('clears a pending resubscribe after the replacement subscription reaches the server', async () => {
    window.localStorage.setItem('itinvent_chat_push_diagnostics', JSON.stringify({
      pendingResubscribe: true,
      lastPushStage: 'sw_pushsubscriptionchange_failed',
    }));
    const existingUnsubscribe = vi.fn().mockResolvedValue(true);
    mockGetSubscription.mockResolvedValue({
      endpoint: 'https://push.example/stale-sub',
      unsubscribe: existingUnsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example/stale-sub',
        expirationTime: null,
        keys: {
          p256dh: 'stale-p256dh',
          auth: 'stale-auth',
        },
      }),
    });

    const { getChatNotificationState, syncChatPushSubscription } = await import('./chatNotifications');

    expect(getChatNotificationState().pendingResubscribe).toBe(true);
    const snapshot = await syncChatPushSubscription({ user: { id: 1 }, force: true });

    expect(existingUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUpsertPushSubscription).toHaveBeenCalledTimes(1);
    expect(snapshot).toEqual(expect.objectContaining({
      pushSubscribed: true,
      pendingResubscribe: false,
      lastError: '',
    }));
    expect(JSON.parse(window.localStorage.getItem('itinvent_chat_push_diagnostics')))
      .toEqual(expect.objectContaining({ pendingResubscribe: false }));
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

  it('registers an installed iPhone Safari PWA for background push', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'iPhone',
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

    const { syncChatPushSubscription } = await import('./chatNotifications');
    const snapshot = await syncChatPushSubscription({ user: { id: 1 } });

    expect(mockUpsertPushSubscription).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://push.example/sub',
      platform: 'iPhone',
      browser_family: 'safari',
      install_mode: 'standalone',
    }));
    expect(snapshot.requiresInstalledPwa).toBe(false);
    expect(snapshot.backgroundCapable).toBe(true);
    expect(snapshot.pushSubscribed).toBe(true);
  });

  it('keeps the shared push subscription when only local chat notifications are disabled', async () => {
    window.localStorage.setItem('itinvent_chat_notifications_enabled', '0');
    const existingUnsubscribe = vi.fn().mockResolvedValue(true);
    const existingSubscription = {
      endpoint: 'https://push.example/shared-sub',
      unsubscribe: existingUnsubscribe,
      toJSON: () => ({
        endpoint: 'https://push.example/shared-sub',
        expirationTime: null,
        keys: {
          p256dh: 'shared-p256dh',
          auth: 'shared-auth',
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
      endpoint: 'https://push.example/shared-sub',
      expiration_time: null,
      p256dh_key: 'shared-p256dh',
      auth_key: 'shared-auth',
      platform: 'Win32',
      browser_family: 'chrome',
      install_mode: 'browser',
    });
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.pushSubscribed).toBe(true);
  });

  it('renews an existing push subscription when the browser subscription key differs from VAPID config', async () => {
    mockGetPushConfig.mockResolvedValue({
      enabled: true,
      vapid_public_key: 'TmV3',
      requires_installed_pwa: true,
      icon_url: '/pwa-192.png',
      badge_url: '/hubit-badge.svg',
    });
    const existingUnsubscribe = vi.fn().mockResolvedValue(true);
    const existingSubscription = {
      endpoint: 'https://push.example/old-sub',
      options: {
        applicationServerKey: new TextEncoder().encode('Old'),
      },
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

    expect(mockDeletePushSubscription).toHaveBeenCalledWith('https://push.example/old-sub');
    expect(existingUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
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

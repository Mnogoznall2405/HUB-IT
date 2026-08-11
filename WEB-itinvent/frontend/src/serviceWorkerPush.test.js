import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('service worker background push', () => {
  let listeners;
  let visibleNotifications;
  let showNotification;
  let workerSelf;
  let cache;
  let fetchMock;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = {};
    visibleNotifications = [];
    showNotification = vi.fn(async (title, options) => {
      visibleNotifications.push({
        title,
        tag: options.tag,
        data: options.data,
        close: vi.fn(),
      });
    });

    workerSelf = {
      location: { origin: 'https://hub.example' },
      navigator: { platform: 'iPhone', userAgent: 'Mobile Safari' },
      registration: {
        showNotification,
        getNotifications: vi.fn(async ({ tag } = {}) => (
          tag
            ? visibleNotifications.filter((item) => item.tag === tag)
            : visibleNotifications
        )),
        pushManager: { subscribe: vi.fn() },
      },
      clients: {
        matchAll: vi.fn(async () => []),
        claim: vi.fn(async () => {}),
        openWindow: vi.fn(async () => {}),
      },
      skipWaiting: vi.fn(async () => {}),
      addEventListener: vi.fn((type, handler) => {
        listeners[type] = handler;
      }),
    };
    cache = {
      match: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
      keys: vi.fn(async () => []),
      addAll: vi.fn(async () => {}),
    };
    const cachesMock = {
      open: vi.fn(async () => cache),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
      match: vi.fn(async () => null),
    };
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const source = fs.readFileSync(path.resolve('public/sw.js'), 'utf8');
    const loadWorker = new Function('self', 'caches', 'fetch', source);
    loadWorker(workerSelf, cachesMock, fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a background chat notification visible for the operating system', async () => {
    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New chat message',
          body: 'Open chat',
          channel: 'chat',
          tag: 'chat:msg:42',
          data: {
            route: '/chat?conversation=7&message=42',
            conversation_id: '7',
            message_id: '42',
          },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await lifetimePromise;

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(visibleNotifications[0].close).not.toHaveBeenCalled();
  });

  it.each([
    ['tasks', '/tasks', 'hub:task-1'],
    ['mail', '/mail?message=mail-1', 'mail:mail-1'],
  ])('shows a background %s notification', async (channel, route, tag) => {
    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: `New ${channel}`,
          body: 'Open notification',
          channel,
          tag,
          data: { route, notification_id: tag },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(visibleNotifications[0]).toEqual(expect.objectContaining({
      tag,
      data: expect.objectContaining({ route: `https://hub.example${route}`, channel }),
    }));
  });

  it.each([
    ['tasks', '/tasks', 'hub:task-focused'],
    ['mail', '/mail?message=mail-focused', 'mail:focused'],
  ])('still shows a system %s notification when a focused PWA client exists', async (channel, route, tag) => {
    workerSelf.clients.matchAll.mockResolvedValue([{
      url: 'https://hub.example/dashboard',
      visibilityState: 'visible',
      focused: true,
      postMessage: vi.fn(),
    }]);

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: `New ${channel}`,
          body: 'Open notification',
          channel,
          tag,
          data: { route, notification_id: tag },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('shows chat notification when another conversation is focused', async () => {
    workerSelf.clients.matchAll.mockResolvedValue([{
      url: 'https://hub.example/chat?conversation=99',
      visibilityState: 'visible',
      focused: true,
      postMessage: vi.fn(),
    }]);

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New chat message',
          body: 'Open chat',
          channel: 'chat',
          tag: 'chat:msg:43',
          data: {
            route: '/chat?conversation=7&message=43',
            conversation_id: '7',
            message_id: '43',
          },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('suppresses external chat push when the open conversation is visible even without focused', async () => {
    const postMessage = vi.fn();
    workerSelf.clients.matchAll.mockResolvedValue([{
      url: 'https://hub.example/chat?conversation=7',
      visibilityState: 'visible',
      focused: false,
      postMessage,
    }]);

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New chat message',
          body: 'Open chat',
          channel: 'chat',
          tag: 'chat:msg:44',
          data: {
            route: '/chat?conversation=7&message=44',
            conversation_id: '7',
            message_id: '44',
          },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(showNotification).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'itinvent:push-foreground-notification',
    }));
  });

  it('suppresses external chat push using page-reported active conversation on mobile SPA urls', async () => {
    const postMessage = vi.fn();
    workerSelf.clients.matchAll.mockResolvedValue([{
      url: 'https://hub.example/chat',
      visibilityState: 'visible',
      focused: false,
      postMessage,
    }]);
    listeners.message({
      data: {
        type: 'itinvent:active-chat-conversation',
        conversationId: '7',
        visible: true,
      },
    });

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New chat message',
          body: 'Open chat',
          channel: 'chat',
          tag: 'chat:msg:45',
          data: {
            route: '/chat?conversation=7&message=45',
            conversation_id: '7',
            message_id: '45',
          },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(showNotification).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'itinvent:push-foreground-notification',
    }));
  });

  it('does not wait for slow push telemetry before showing the notification', async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes('/notifications/push-debug')) {
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });

    listeners.push({
      data: {
        json: () => ({
          title: 'New task',
          body: 'Open task',
          channel: 'tasks',
          tag: 'hub:slow-telemetry',
          data: { route: '/tasks', notification_id: 'slow-telemetry' },
        }),
      },
      waitUntil: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('retries notification display with minimal options when advanced options fail', async () => {
    showNotification
      .mockRejectedValueOnce(new TypeError('Unsupported notification option'))
      .mockResolvedValueOnce(undefined);

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New mail',
          body: 'Open mail',
          channel: 'mail',
          tag: 'mail:fallback',
          data: { route: '/mail', message_id: 'fallback' },
          actions: [{ action: 'open-mail', title: 'Open', route: '/mail' }],
          vibrate: [200, 100, 200],
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await expect(lifetimePromise).resolves.toBeUndefined();
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(showNotification.mock.calls[1][1]).not.toHaveProperty('actions');
    expect(showNotification.mock.calls[1][1]).not.toHaveProperty('vibrate');
  });

  it('still displays a notification when the window client snapshot is unavailable', async () => {
    workerSelf.clients.matchAll.mockRejectedValueOnce(new Error('Client API unavailable'));

    let lifetimePromise;
    listeners.push({
      data: {
        json: () => ({
          title: 'New task',
          body: 'Open task',
          channel: 'tasks',
          tag: 'hub:no-client-snapshot',
          data: { route: '/tasks', notification_id: 'no-client-snapshot' },
        }),
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await expect(lifetimePromise).resolves.toBeUndefined();
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it('persists a replacement subscription when the server upsert fails', async () => {
    const replacementSubscription = {
      endpoint: 'https://push.example/replacement',
      toJSON: () => ({
        endpoint: 'https://push.example/replacement',
        expirationTime: null,
        keys: { p256dh: 'replacement-p256dh', auth: 'replacement-auth' },
      }),
    };
    workerSelf.registration.pushManager.subscribe.mockResolvedValue(replacementSubscription);
    fetchMock.mockImplementation(async (url, options = {}) => {
      const isUpsert = String(url).includes('/notifications/push-subscription')
        && String(options?.method || '').toUpperCase() === 'PUT';
      return {
        ok: !isUpsert,
        status: isUpsert ? 500 : 200,
        json: async () => ({}),
      };
    });

    let lifetimePromise;
    listeners.pushsubscriptionchange({
      oldSubscription: {
        endpoint: 'https://push.example/old',
        options: {
          userVisibleOnly: true,
          applicationServerKey: new Uint8Array([1, 2, 3]),
        },
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(cache.put).toHaveBeenCalledWith(
      'https://hub.example/__push/pending-sync',
      expect.any(Response),
    );
    expect(cache.delete).not.toHaveBeenCalledWith('https://hub.example/__push/pending-sync');
  });

  it('keeps pending subscription sync queued when a later flush still fails', async () => {
    cache.match.mockResolvedValue(new Response(JSON.stringify({
      old_endpoint: 'https://push.example/old',
      subscription: {
        endpoint: 'https://push.example/replacement',
        expiration_time: null,
        p256dh_key: 'replacement-p256dh',
        auth_key: 'replacement-auth',
      },
    }), { headers: { 'Content-Type': 'application/json' } }));
    fetchMock.mockImplementation(async (url, options = {}) => {
      const isUpsert = String(url).includes('/notifications/push-subscription')
        && String(options?.method || '').toUpperCase() === 'PUT';
      return {
        ok: !isUpsert,
        status: isUpsert ? 503 : 200,
        json: async () => ({}),
      };
    });

    let lifetimePromise;
    listeners.message({
      data: { type: 'itinvent:push-sync-drain' },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(cache.delete).not.toHaveBeenCalledWith('https://hub.example/__push/pending-sync');
  });

  it('allows the same chat push to retry after notification display fails', async () => {
    showNotification
      .mockRejectedValueOnce(new Error('Primary display failed'))
      .mockRejectedValueOnce(new Error('Fallback display failed'))
      .mockResolvedValueOnce(undefined);

    const dispatchChatPush = () => {
      let lifetimePromise;
      listeners.push({
        data: {
          json: () => ({
            title: 'Retry chat',
            body: 'Retry body',
            channel: 'chat',
            tag: 'chat:msg:retry-1',
            data: {
              route: '/chat?conversation=7&message=retry-1',
              conversation_id: '7',
              message_id: 'retry-1',
            },
          }),
        },
        waitUntil: (promise) => {
          lifetimePromise = promise;
        },
      });
      return lifetimePromise;
    };

    await expect(dispatchChatPush()).rejects.toThrow('Fallback display failed');
    await expect(dispatchChatPush()).resolves.toBeUndefined();

    expect(showNotification).toHaveBeenCalledTimes(3);
  });

  it('opens notification targets via SPA postMessage without client.navigate reload', async () => {
    const focusedClient = {
      url: 'https://hub.example/dashboard',
      visibilityState: 'visible',
      focused: true,
      postMessage: vi.fn(),
      focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
    };
    workerSelf.clients.matchAll.mockResolvedValue([focusedClient]);

    let lifetimePromise;
    listeners.notificationclick({
      action: '',
      notification: {
        close: vi.fn(),
        tag: 'chat:msg:spa-1',
        data: {
          route: 'https://hub.example/chat?conversation=7&message=spa-1',
          channel: 'chat',
          actions: [],
        },
      },
      waitUntil: (promise) => {
        lifetimePromise = promise;
      },
    });

    await lifetimePromise;

    expect(focusedClient.postMessage).toHaveBeenCalledWith({
      type: 'itinvent:navigate',
      route: '/chat?conversation=7&message=spa-1',
      url: 'https://hub.example/chat?conversation=7&message=spa-1',
      source: 'notificationclick',
    });
    expect(focusedClient.focus).toHaveBeenCalledTimes(1);
    expect(focusedClient.navigate).not.toHaveBeenCalled();
    expect(workerSelf.clients.openWindow).not.toHaveBeenCalled();
  });

  it('disables IIS caching for the service worker entry script', () => {
    const webConfig = fs.readFileSync(path.resolve('public/web.config'), 'utf8');
    const serviceWorkerLocation = webConfig.match(/<location path="sw\.js">([\s\S]*?)<\/location>/)?.[1] || '';

    expect(serviceWorkerLocation).toContain('Cache-Control');
    expect(serviceWorkerLocation).toContain('no-cache, no-store, must-revalidate');
    expect(serviceWorkerLocation).toContain('cacheControlMode="DisableCache"');
  });
});

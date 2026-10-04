// Unit coverage is justified here: the capability gate (old desktop hosts reject
// unknown messages), the 64-char group bound and the per-chat throttle form a
// small offline state machine that E2E cannot reach without a real WebView2 host.
import { afterEach, describe, expect, it, vi } from 'vitest';

const installTransport = () => {
  const listeners = new Set();
  const transport = {
    addEventListener: vi.fn((type, listener) => {
      if (type === 'message') listeners.add(listener);
    }),
    postMessage: vi.fn(),
    emit(data) {
      listeners.forEach((listener) => listener({ data }));
    },
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: { webview: transport } });
  return transport;
};

const installServiceWorker = () => {
  const controller = { postMessage: vi.fn() };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller, getRegistration: vi.fn(async () => null) },
  });
  return controller;
};

const startDesktopHost = async (capabilities) => {
  const transport = installTransport();
  const { initializeDesktopBridge } = await import('./desktopBridge');
  const initialized = initializeDesktopBridge();
  transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
  await initialized;
  if (capabilities) transport.emit({ type: 'desktop.capabilities', version: 1, capabilities });
  transport.postMessage.mockClear();
  return transport;
};

const clearGroupMessages = (transport) => transport.postMessage.mock.calls
  .map(([message]) => message)
  .filter((message) => message?.type === 'notification.clearGroup');

afterEach(() => {
  vi.resetModules();
  delete window.chrome;
  delete navigator.serviceWorker;
});

describe('clearChatConversationNotifications', () => {
  it('sends exact clearGroup messages only when the host declares the capability', async () => {
    const transport = await startDesktopHost(['notification-clear-group']);
    const { clearChatConversationNotifications } = await import('./chatNotificationClear');

    expect(clearChatConversationNotifications('conv-1', { taskId: 'task-9', now: 1_000 })).toBe(true);

    expect(clearGroupMessages(transport)).toEqual([
      { type: 'notification.clearGroup', version: 1, group: 'task:task-9' },
      { type: 'notification.clearGroup', version: 1, group: 'chat:conv-1' },
    ]);
  });

  it('does not message old hosts without the capability', async () => {
    const transport = await startDesktopHost(['print']);
    const { clearChatConversationNotifications } = await import('./chatNotificationClear');

    clearChatConversationNotifications('conv-1', { now: 1_000 });

    expect(clearGroupMessages(transport)).toEqual([]);
  });

  it('skips groups the host would reject (too long or unsafe characters)', async () => {
    const transport = await startDesktopHost(['notification-clear-group']);
    const { clearChatConversationNotifications } = await import('./chatNotificationClear');

    clearChatConversationNotifications('c'.repeat(60), { taskId: 'task 1', now: 1_000 });

    expect(clearGroupMessages(transport)).toEqual([]);
  });

  it('throttles repeated clears per conversation and posts to the service worker', async () => {
    const controller = installServiceWorker();
    const { clearChatConversationNotifications } = await import('./chatNotificationClear');

    expect(clearChatConversationNotifications('conv-1', { now: 10_000 })).toBe(true);
    expect(clearChatConversationNotifications('conv-1', { now: 11_500 })).toBe(false);
    expect(clearChatConversationNotifications('conv-2', { now: 11_500 })).toBe(true);
    expect(clearChatConversationNotifications('conv-1', { now: 12_000 })).toBe(true);

    expect(controller.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'itinvent:chat-clear-conversation-notifications', conversation_id: 'conv-1' },
      { type: 'itinvent:chat-clear-conversation-notifications', conversation_id: 'conv-2' },
      { type: 'itinvent:chat-clear-conversation-notifications', conversation_id: 'conv-1' },
    ]);
  });

  it('closes page-created notifications of the opened chat only', async () => {
    const {
      clearChatConversationNotifications,
      rememberChatConversationNotification,
    } = await import('./chatNotificationClear');
    const opened = { close: vi.fn() };
    const other = { close: vi.fn() };
    rememberChatConversationNotification('conv-1', opened);
    rememberChatConversationNotification('conv-2', other);

    clearChatConversationNotifications('conv-1', { now: 1_000 });

    expect(opened.close).toHaveBeenCalledTimes(1);
    expect(other.close).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

const chatMocks = vi.hoisted(() => ({
  ChatSocketClient: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../api/client', () => ({
  authAPI: {
    refresh: (...args) => authMocks.refresh(...args),
  },
}));

vi.mock('./chatSocket', () => ({
  ChatSocketClient: chatMocks.ChatSocketClient,
  chatSocket: {
    connect: chatMocks.connect,
  },
}));

import {
  createDesktopLifecycleController,
  DESKTOP_LIFECYCLE_RECOVERY_EVENT,
  DESKTOP_PRESENCE_HEARTBEAT_EVENT,
  MAIL_NEEDS_REFRESH_EVENT,
  MAX_LIFECYCLE_EVENT_AGE_MS,
  MAX_LIFECYCLE_FUTURE_SKEW_MS,
  startDesktopLifecycleRecovery,
} from './desktopLifecycle';

const FRESH_UTC = '2026-08-19T10:00:00Z';
const FRESH_MS = Date.parse(FRESH_UTC);

const resumeEvent = (generation = 12, occurredUtc = FRESH_UTC) => ({
  type: 'desktop.system.resume',
  generation,
  occurredUtc,
  available: null,
  isRecoveryAttempt: true,
});

const networkEvent = (generation, available, occurredUtc = FRESH_UTC) => ({
  type: 'desktop.network.changed',
  generation,
  occurredUtc,
  available,
  isRecoveryAttempt: available === true,
});

describe('desktopLifecycle', () => {
  beforeEach(() => {
    authMocks.refresh.mockReset();
    authMocks.refresh.mockResolvedValue({ ok: true });
    chatMocks.ChatSocketClient.mockReset();
    chatMocks.connect.mockReset();
    window.localStorage.setItem('user', JSON.stringify({ id: 7, username: 'tester' }));
  });

  afterEach(() => {
    window.localStorage.removeItem('user');
    vi.useRealTimers();
  });

  const createController = (overrides = {}) => {
    const timers = [];
    const controller = createDesktopLifecycleController({
      cooldownMs: 15_000,
      now: () => FRESH_MS,
      isAuthenticated: () => true,
      scheduleOneShot: (delayMs, callback) => {
        timers.push({ delayMs, callback });
        return () => {
          const index = timers.findIndex((item) => item.callback === callback);
          if (index >= 0) timers.splice(index, 1);
        };
      },
      ...overrides,
    });
    return { controller, timers, flushTimers: () => {
      const queued = [...timers];
      timers.length = 0;
      queued.forEach((item) => item.callback());
    } };
  };

  it('runs one recovery cycle for desktop.system.resume', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const notifyMailNeedsRefresh = vi.fn();
    const notifyChatNeedsRecovery = vi.fn();
    const notifyPresenceHeartbeat = vi.fn();
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh,
      notifyChatNeedsRecovery,
      notifyPresenceHeartbeat,
    });

    await controller.handleEvent(resumeEvent(12));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(notifyMailNeedsRefresh).toHaveBeenCalledTimes(1);
    expect(notifyChatNeedsRecovery).toHaveBeenCalledTimes(1);
    expect(notifyPresenceHeartbeat).toHaveBeenCalledTimes(1);
    expect(controller.getRecoveryCycles()).toBe(1);
    expect(chatMocks.ChatSocketClient).not.toHaveBeenCalled();
    expect(chatMocks.connect).not.toHaveBeenCalled();
  });

  it('runs recovery for desktop.network.changed available=true', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const notifyMailNeedsRefresh = vi.fn();
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh,
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(networkEvent(13, true));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(notifyMailNeedsRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not recover when available=false', async () => {
    const refreshAuth = vi.fn();
    const notifyMailNeedsRefresh = vi.fn();
    const notifyChatNeedsRecovery = vi.fn();
    const notifyPresenceHeartbeat = vi.fn();
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh,
      notifyChatNeedsRecovery,
      notifyPresenceHeartbeat,
    });

    await controller.handleEvent(networkEvent(14, false));

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(notifyMailNeedsRefresh).not.toHaveBeenCalled();
    expect(notifyChatNeedsRecovery).not.toHaveBeenCalled();
    expect(notifyPresenceHeartbeat).not.toHaveBeenCalled();
    expect(controller.getRecoveryCycles()).toBe(0);
  });

  it('ignores a repeated generation', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(12));
    await controller.handleEvent(resumeEvent(12));

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(controller.getRecoveryCycles()).toBe(1);
  });

  it('queues a cooldown event and runs only the last one after the one-shot timer', async () => {
    let now = FRESH_MS;
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller, flushTimers, timers } = createController({
      cooldownMs: 15_000,
      now: () => now,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(1));
    now += 1_000;
    await controller.handleEvent(networkEvent(2, true));
    await controller.handleEvent(resumeEvent(3));
    await controller.handleEvent(resumeEvent(4));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);

    now += 14_000;
    flushTimers();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(controller.getLastGeneration()).toBe(4);
  });

  it('does not call APIs when the user is logged out', async () => {
    const refreshAuth = vi.fn();
    const { controller } = createController({
      isAuthenticated: () => false,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(20));

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(controller.getRecoveryCycles()).toBe(0);
  });

  it('uses the existing authAPI.refresh client by default', async () => {
    const controller = createDesktopLifecycleController({
      cooldownMs: 15_000,
      now: () => FRESH_MS,
      isAuthenticated: () => true,
    });
    const mail = vi.fn();
    const chat = vi.fn();
    const presence = vi.fn();
    window.addEventListener(MAIL_NEEDS_REFRESH_EVENT, mail);
    window.addEventListener(DESKTOP_LIFECYCLE_RECOVERY_EVENT, chat);
    window.addEventListener(DESKTOP_PRESENCE_HEARTBEAT_EVENT, presence);

    await controller.handleEvent(resumeEvent(8));

    expect(authMocks.refresh).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(presence).toHaveBeenCalledTimes(1);
  });

  it('does not logout on a single temporary network error', async () => {
    const refreshAuth = vi.fn().mockRejectedValue({ message: 'network', response: undefined });
    const notifyMailNeedsRefresh = vi.fn();
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh,
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(21));

    expect(notifyMailNeedsRefresh).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('user')).toContain('tester');
  });

  it('stops mail/chat/presence after a definitive session rejection', async () => {
    const refreshAuth = vi.fn().mockRejectedValue({ response: { status: 401 } });
    const notifyMailNeedsRefresh = vi.fn();
    const notifyChatNeedsRecovery = vi.fn();
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh,
      notifyChatNeedsRecovery,
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(22));

    expect(notifyMailNeedsRefresh).not.toHaveBeenCalled();
    expect(notifyChatNeedsRecovery).not.toHaveBeenCalled();
  });

  it('ignores ten identical generations after the first recovery', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller } = createController({
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    for (let index = 0; index < 10; index += 1) {
      await controller.handleEvent(resumeEvent(12));
    }

    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(controller.getRecoveryCycles()).toBe(1);
  });

  it('does not recover after dispose/unmount', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller } = createController({ refreshAuth });
    controller.dispose();
    await controller.handleEvent(resumeEvent(30));
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('does not change browser runtime without a Desktop bridge', () => {
    const stop = startDesktopLifecycleRecovery({
      refreshAuth: authMocks.refresh,
    });

    expect(authMocks.refresh).not.toHaveBeenCalled();
    stop();
  });

  it('runs event B after in-flight A completes', async () => {
    let resolveFirst;
    const refreshAuth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({});
    const { controller } = createController({
      cooldownMs: 0,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    const first = controller.handleEvent(resumeEvent(1));
    await Promise.resolve();
    const second = controller.handleEvent(networkEvent(2, true));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    resolveFirst({});
    await first;
    await second;
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(controller.getLastGeneration()).toBe(2);
  });

  it('keeps a later available=true after a transient auth error', async () => {
    let now = FRESH_MS;
    const refreshAuth = vi.fn()
      .mockRejectedValueOnce({ message: 'network' })
      .mockResolvedValueOnce({});
    const { controller, flushTimers } = createController({
      now: () => now,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(12));
    expect(refreshAuth).toHaveBeenCalledTimes(1);

    now += 5_000;
    await controller.handleEvent(networkEvent(13, true));
    expect(refreshAuth).toHaveBeenCalledTimes(1);

    now += 10_000;
    flushTimers();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(controller.getRecoveryCycles()).toBe(2);
  });

  it('does not let an older available=false cancel a newer pending recovery', async () => {
    let now = FRESH_MS;
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller, flushTimers, timers } = createController({
      now: () => now,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(1));
    now += 1_000;
    await controller.handleEvent(networkEvent(10, true));
    expect(timers).toHaveLength(1);
    await controller.handleEvent(networkEvent(9, false));
    expect(timers).toHaveLength(1);

    now += 14_000;
    flushTimers();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(controller.getLastGeneration()).toBe(10);
  });

  it('ignores a duplicate available=false of the pending generation and still recovers after cooldown', async () => {
    let now = FRESH_MS;
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller, flushTimers, timers } = createController({
      now: () => now,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(1));
    now += 1_000;
    await controller.handleEvent(networkEvent(10, true));
    expect(timers).toHaveLength(1);
    await controller.handleEvent(networkEvent(10, false));
    expect(timers).toHaveLength(1);

    now += 14_000;
    flushTimers();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(controller.getLastGeneration()).toBe(10);
  });

  it('cancels pending recovery when available=false', async () => {
    let now = FRESH_MS;
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller, flushTimers, timers } = createController({
      now: () => now,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(1));
    now += 1_000;
    await controller.handleEvent(networkEvent(10, true));
    expect(timers).toHaveLength(1);
    await controller.handleEvent(networkEvent(11, false));
    expect(timers).toHaveLength(0);
    now += 20_000;
    flushTimers();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('does not run pending recovery after dispose', async () => {
    let resolveFirst;
    const refreshAuth = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    const { controller } = createController({
      cooldownMs: 0,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    const first = controller.handleEvent(resumeEvent(1));
    await Promise.resolve();
    controller.handleEvent(networkEvent(2, true));
    controller.dispose();
    resolveFirst({});
    await first;
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('accepts an event a few seconds in the future', async () => {
    const refreshAuth = vi.fn().mockResolvedValue({});
    const { controller } = createController({
      now: () => FRESH_MS,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(
      50,
      new Date(FRESH_MS + MAX_LIFECYCLE_FUTURE_SKEW_MS).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('rejects an event a minute in the future', async () => {
    const refreshAuth = vi.fn();
    const { controller } = createController({
      now: () => FRESH_MS,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(51, '2026-08-19T10:01:00Z'));
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('ignores a stale occurredUtc event', async () => {
    const refreshAuth = vi.fn();
    const { controller } = createController({
      now: () => FRESH_MS + MAX_LIFECYCLE_EVENT_AGE_MS + 1_000,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(40, FRESH_UTC));
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('does not replay a logout event after a later login', async () => {
    let authenticated = false;
    let now = FRESH_MS;
    const refreshAuth = vi.fn();
    const { controller } = createController({
      now: () => now,
      isAuthenticated: () => authenticated,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    await controller.handleEvent(resumeEvent(41));
    authenticated = true;
    now += MAX_LIFECYCLE_EVENT_AGE_MS + 1_000;
    await controller.handleEvent(resumeEvent(41));
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it('attaches the lifecycle subscriber after a late hostReady', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FRESH_UTC));
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
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: transport },
    });
    vi.resetModules();
    const { initializeDesktopBridge } = await import('./desktopBridge');
    const { startDesktopLifecycleRecovery } = await import('./desktopLifecycle');
    const refreshAuth = vi.fn().mockResolvedValue({});
    const initialization = initializeDesktopBridge();
    const stop = startDesktopLifecycleRecovery({
      isAuthenticated: () => true,
      refreshAuth,
      notifyMailNeedsRefresh: vi.fn(),
      notifyChatNeedsRecovery: vi.fn(),
      notifyPresenceHeartbeat: vi.fn(),
    });

    expect(refreshAuth).not.toHaveBeenCalled();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: FRESH_UTC,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    stop();
    delete window.chrome;
  });
});

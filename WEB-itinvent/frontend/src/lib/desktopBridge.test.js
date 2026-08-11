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

  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: { webview: transport },
  });
  return transport;
};

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  delete window.chrome;
  document.documentElement.removeAttribute('data-desktop-shell');
});

describe('desktopBridge', () => {
  it('stays disabled in a regular browser', async () => {
    const { initializeDesktopBridge, isDesktopBridgeReady } = await import('./desktopBridge');

    await expect(initializeDesktopBridge()).resolves.toBe(false);
    expect(isDesktopBridgeReady()).toBe(false);
  });

  it('completes the versioned WebView2 handshake', async () => {
    const transport = installTransport();
    const {
      DESKTOP_BRIDGE_PROTOCOL_VERSION,
      getDesktopWindowsUsername,
      initializeDesktopBridge,
      isDesktopBridgeReady,
    } = await import('./desktopBridge');

    const initialization = initializeDesktopBridge();
    expect(transport.postMessage).toHaveBeenCalledWith({
      type: 'desktop.ready',
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
    });

    transport.emit({
      type: 'desktop.hostReady',
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      capabilities: { notifications: true },
      windowsUsername: 'ivanov',
    });

    await expect(initialization).resolves.toBe(true);
    expect(isDesktopBridgeReady()).toBe(true);
    expect(getDesktopWindowsUsername()).toBe('ivanov');
    expect(document.documentElement.dataset.desktopShell).toBe('true');

    const { isNativeShellRuntime } = await import('./platform');
    expect(isNativeShellRuntime()).toBe(true);
  });

  it('syncs only supported themes after the desktop handshake', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, syncDesktopTheme } = await import('./desktopBridge');

    expect(syncDesktopTheme('dark')).toBe(false);
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(syncDesktopTheme('dark')).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'appearance.theme',
      version: 1,
      mode: 'dark',
    });
    expect(syncDesktopTheme('system')).toBe(false);
  });

  it('tracks strict host window foreground state messages', async () => {
    const transport = installTransport();
    const {
      DESKTOP_WINDOW_STATE_CHANGED_EVENT,
      getDesktopWindowForeground,
      initializeDesktopBridge,
    } = await import('./desktopBridge');
    const stateChanged = vi.fn();
    window.addEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, stateChanged);

    expect(getDesktopWindowForeground()).toBeNull();
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    transport.emit({ type: 'desktop.windowState', version: 1, foreground: false });
    expect(getDesktopWindowForeground()).toBe(false);
    expect(stateChanged).toHaveBeenCalledWith(expect.objectContaining({
      detail: { foreground: false },
    }));

    transport.emit({ type: 'desktop.windowState', version: 1, foreground: true, command: 'open' });
    expect(getDesktopWindowForeground()).toBe(false);
    expect(stateChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, stateChanged);
  });

  it('posts a strictly shaped native notification only when the capability is available', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      isDesktopNotificationAvailable,
      showDesktopNotification,
    } = await import('./desktopBridge');

    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(isDesktopNotificationAvailable()).toBe(true);
    expect(showDesktopNotification({
      id: 'chat:msg:42',
      title: 'Иван',
      body: 'Новое сообщение',
      route: '/chat?conversation=7&message=42',
    })).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'notification.show',
      version: 1,
      id: 'chat:msg:42',
      title: 'Иван',
      body: 'Новое сообщение',
      route: '/chat?conversation=7&message=42',
    });
  });

  it('requests that the desktop host open the next downloaded document', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, requestDesktopOpenDownloadedFile } = await import('./desktopBridge');

    expect(requestDesktopOpenDownloadedFile()).toBe(false);
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(requestDesktopOpenDownloadedFile()).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'file.openDownloaded',
      version: 1,
    });
  });

  it('rejects unsafe native notification input', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, showDesktopNotification } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(showDesktopNotification({
      id: 'chat:msg:42',
      title: 'Иван',
      body: 'Новое сообщение',
      route: 'https://evil.example/chat',
    })).toBe(false);
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
  });

  it('queues a trusted desktop navigation until React subscribes', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopNavigation } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    transport.emit({
      type: 'navigation.open',
      version: 1,
      route: '/chat?conversation=7&message=42',
    });

    const listener = vi.fn();
    const unsubscribe = subscribeDesktopNavigation(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('/chat?conversation=7&message=42');

    transport.emit({ type: 'navigation.open', version: 1, route: '/tasks?task=9' });
    expect(listener).toHaveBeenLastCalledWith('/tasks?task=9');

    unsubscribe();
    transport.emit({ type: 'navigation.open', version: 1, route: '/dashboard' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects unsafe or malformed desktop navigation messages', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopNavigation } = await import('./desktopBridge');
    const listener = vi.fn();
    subscribeDesktopNavigation(listener);
    const initialization = initializeDesktopBridge();

    transport.emit({ type: 'navigation.open', version: 1, route: '/chat' });
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({ type: 'navigation.open', version: 2, route: '/chat' });
    transport.emit({ type: 'navigation.open', version: 1, route: 'https://evil.example/chat' });
    transport.emit({ type: 'navigation.open', version: 1, route: '/chat', command: 'open' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects mismatched versions and unknown fields', async () => {
    vi.useFakeTimers();
    const transport = installTransport();
    const { initializeDesktopBridge, isDesktopBridgeReady } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge({ timeoutMs: 25 });

    transport.emit({ type: 'desktop.hostReady', version: 2, capabilities: { notifications: true } });
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true }, command: 'open' });
    await vi.advanceTimersByTimeAsync(25);

    await expect(initialization).resolves.toBe(false);
    expect(isDesktopBridgeReady()).toBe(false);
  });

  it('initializes only once per app load', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge } = await import('./desktopBridge');

    const first = initializeDesktopBridge();
    const second = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
    expect(transport.addEventListener).toHaveBeenCalledTimes(1);
  });
});

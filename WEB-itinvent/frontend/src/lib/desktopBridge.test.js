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

  it('publishes shell status only after the separate capability arrives', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      isDesktopCapabilityAvailable,
      syncDesktopShellStatus,
    } = await import('./desktopBridge');
    const status = {
      authenticated: true,
      online: true,
      unread_total: 7,
      chat_unread: 4,
      mail_unread: 2,
      tasks_attention: 1,
    };

    const initialization = initializeDesktopBridge();
    expect(syncDesktopShellStatus(status)).toBe(false);
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(isDesktopCapabilityAvailable('shell-status')).toBe(false);
    expect(transport.postMessage).toHaveBeenCalledTimes(1);

    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['shell-status'],
    });

    expect(isDesktopCapabilityAvailable('shell-status')).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'shell.status',
      version: 1,
      ...status,
    });
  });

  it('sends only the semantic print command after print capability arrives', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, requestDesktopPrintCurrent } = await import('./desktopBridge');

    expect(requestDesktopPrintCurrent()).toBe(false);
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    expect(requestDesktopPrintCurrent()).toBe(false);

    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['print'],
    });

    expect(requestDesktopPrintCurrent()).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'document.printCurrent',
      version: 1,
    });
  });

  it('requests strict quick QR printing and resolves the matching native result', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      requestDesktopEquipmentQrPrint,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['equipment-qr-print'],
    });

    const request = requestDesktopEquipmentQrPrint('quick');
    const message = transport.postMessage.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === 'equipmentQr.print');
    expect(message).toMatchObject({ version: 1, mode: 'quick' });
    expect(Object.keys(message).sort()).toEqual(['mode', 'requestId', 'type', 'version']);

    transport.emit({
      type: 'equipmentQr.printResult',
      version: 1,
      requestId: message.requestId,
      status: 'succeeded',
    });
    await expect(request).resolves.toEqual({ accepted: true, status: 'succeeded' });
  });

  it('rejects unsupported QR print modes and malformed native results', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      requestDesktopEquipmentQrPrint,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['equipment-qr-print'],
    });

    await expect(requestDesktopEquipmentQrPrint('silent'))
      .resolves.toEqual({ accepted: false, status: 'unavailable' });

    const request = requestDesktopEquipmentQrPrint('dialog');
    const message = transport.postMessage.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === 'equipmentQr.print');
    transport.emit({
      type: 'equipmentQr.printResult',
      version: 1,
      requestId: message.requestId,
      status: 'succeeded',
      printer: 'unsafe',
    });
    expect(transport.postMessage).toHaveBeenCalledWith(message);
    transport.emit({
      type: 'equipmentQr.printResult',
      version: 1,
      requestId: message.requestId,
      status: 'dialog-opened',
    });
    await expect(request).resolves.toEqual({ accepted: true, status: 'dialog-opened' });
  });

  it('dispatches palette requests and sends only closed Desktop action commands', async () => {
    const transport = installTransport();
    const openPalette = vi.fn();
    window.addEventListener('itinvent:desktop-open-command-palette', openPalette);
    const {
      initializeDesktopBridge,
      requestDesktopCheckForUpdates,
      requestDesktopOpenCurrentInBrowser,
      requestDesktopOpenDiagnostics,
      requestDesktopOpenDownloads,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['command-palette', 'desktop-actions'],
    });
    transport.emit({ type: 'command.openPalette', version: 1 });

    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(requestDesktopOpenDownloads()).toBe(true);
    expect(requestDesktopOpenDiagnostics()).toBe(true);
    expect(requestDesktopCheckForUpdates()).toBe(true);
    expect(requestDesktopOpenCurrentInBrowser()).toBe(true);
    expect(transport.postMessage.mock.calls.slice(-4).map(([message]) => message.type)).toEqual([
      'desktop.openDownloads',
      'desktop.openDiagnostics',
      'desktop.checkForUpdates',
      'desktop.openCurrentInBrowser',
    ]);

    window.removeEventListener('itinvent:desktop-open-command-palette', openPalette);
  });

  it('checks only VNC handler availability without sending an address or credentials', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      requestDesktopVncPreflight,
    } = await import('./desktopBridge');

    await expect(requestDesktopVncPreflight()).resolves.toEqual({
      available: false,
      status: 'unavailable',
    });
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['vnc-preflight'],
    });

    const preflight = requestDesktopVncPreflight();
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'remote.vncPreflight',
      version: 1,
    });
    transport.emit({
      type: 'remote.vncPreflightResult',
      version: 1,
      status: 'available',
    });
    await expect(preflight).resolves.toEqual({ available: true, status: 'available' });
  });

  it('rejects expanded VNC preflight results', async () => {
    vi.useFakeTimers();
    const transport = installTransport();
    const { initializeDesktopBridge, requestDesktopVncPreflight } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['vnc-preflight'],
    });

    const preflight = requestDesktopVncPreflight();
    transport.emit({
      type: 'remote.vncPreflightResult',
      version: 1,
      status: 'available',
      uri: 'vnc://host?token=secret',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(preflight).resolves.toEqual({ available: false, status: 'unavailable' });
  });

  it('rejects malformed shell capabilities and status values', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      isDesktopCapabilityAvailable,
      syncDesktopShellStatus,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['shell-status'],
      command: 'open',
    });
    expect(isDesktopCapabilityAvailable('shell-status')).toBe(false);
    expect(syncDesktopShellStatus({
      authenticated: true,
      online: true,
      unread_total: -1,
      chat_unread: 0,
      mail_unread: 0,
      tasks_attention: 0,
    })).toBe(false);
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
  });

  it('publishes only strict quick routes after capability negotiation', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, syncDesktopQuickRoutes } = await import('./desktopBridge');
    const routes = [
      { id: 'tasks', label: 'Задачи', route: '/tasks', badge: 3 },
      { id: 'mail', label: 'Почта', route: '/mail', badge: 2 },
    ];
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    expect(syncDesktopQuickRoutes(routes)).toBe(false);
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['quick-routes', 'shell-status'],
    });

    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'shell.quickRoutes',
      version: 1,
      routes,
    });
    expect(syncDesktopQuickRoutes(routes)).toBe(true);
  });

  it('rejects duplicate, unsafe, or oversized quick routes', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, syncDesktopQuickRoutes } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['quick-routes'],
    });

    expect(syncDesktopQuickRoutes([
      { id: 'tasks', label: 'Задачи', route: '/tasks', badge: 1 },
      { id: 'tasks', label: 'Подмена', route: '/mail', badge: 0 },
    ])).toBe(false);
    expect(syncDesktopQuickRoutes([
      { id: 'bad route', label: 'Bad', route: 'https://evil.example', badge: -1 },
    ])).toBe(false);
    expect(syncDesktopQuickRoutes(Array.from({ length: 13 }, (_, index) => ({
      id: `route-${index}`,
      label: `Route ${index}`,
      route: `/route-${index}`,
      badge: 0,
    })))).toBe(false);
    expect(transport.postMessage).toHaveBeenCalledTimes(1);
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

    await expect(requestDesktopOpenDownloadedFile()).resolves.toEqual({
      accepted: false,
      status: 'unavailable',
    });
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    const request = requestDesktopOpenDownloadedFile();
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'file.openDownloaded',
      version: 1,
    });
    transport.emit({
      type: 'file.openDownloadedResult',
      version: 1,
      status: 'accepted',
    });
    await expect(request).resolves.toEqual({ accepted: true, status: 'accepted' });
  });

  it('prepares strict native print, copy and save-as download actions', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      requestDesktopDownloadedFileAction,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['file-actions-v2'],
    });

    for (const action of ['print', 'copy', 'saveAs']) {
      const request = requestDesktopDownloadedFileAction(action);
      expect(transport.postMessage).toHaveBeenLastCalledWith({
        type: 'file.prepareDownload',
        version: 1,
        action,
      });
      transport.emit({
        type: 'file.prepareDownloadResult',
        version: 1,
        action,
        status: 'accepted',
      });
      await expect(request).resolves.toEqual({ accepted: true, status: 'accepted' });
    }

    await expect(requestDesktopDownloadedFileAction('execute')).resolves.toEqual({
      accepted: false,
      status: 'unsupported',
    });
  });

  it('returns a controlled busy result and allows only one pending open intent', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, requestDesktopOpenDownloadedFile } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    const firstRequest = requestDesktopOpenDownloadedFile();
    await expect(requestDesktopOpenDownloadedFile()).resolves.toEqual({
      accepted: false,
      status: 'busy',
    });
    expect(transport.postMessage).toHaveBeenCalledTimes(2);

    transport.emit({
      type: 'file.openDownloadedResult',
      version: 1,
      status: 'busy',
    });
    await expect(firstRequest).resolves.toEqual({ accepted: false, status: 'busy' });
  });

  it('keeps compatibility with a legacy host that does not acknowledge the open intent', async () => {
    vi.useFakeTimers();
    const transport = installTransport();
    const { initializeDesktopBridge, requestDesktopOpenDownloadedFile } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    const request = requestDesktopOpenDownloadedFile();
    await vi.advanceTimersByTimeAsync(600);
    await expect(request).resolves.toEqual({ accepted: true, status: 'legacy' });
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

  it('keeps the last lifecycle event until a subscriber is ready', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T10:00:00Z'));
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopLifecycle } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;

    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: '2026-08-19T10:00:00Z',
    });
    transport.emit({
      type: 'desktop.network.changed',
      version: 1,
      generation: 13,
      available: true,
      occurredUtc: '2026-08-19T10:00:02Z',
    });

    const listener = vi.fn();
    const unsubscribe = subscribeDesktopLifecycle(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: 'desktop.network.changed',
      generation: 13,
      occurredUtc: '2026-08-19T10:00:02Z',
      available: true,
      isRecoveryAttempt: true,
    });

    const lateSubscriber = vi.fn();
    subscribeDesktopLifecycle(lateSubscriber);
    expect(lateSubscriber).not.toHaveBeenCalled();

    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 14,
      occurredUtc: '2026-08-19T10:00:04Z',
    });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 15,
      occurredUtc: '2026-08-19T10:00:05Z',
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized or extra-field lifecycle payloads', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopLifecycle } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;
    const listener = vi.fn();
    subscribeDesktopLifecycle(listener);

    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: '2026-08-19T10:00:00Z',
      ip: '10.0.0.1',
    });
    transport.emit({
      type: 'desktop.network.changed',
      version: 1,
      generation: 13,
      available: true,
      occurredUtc: '2026-08-19T10:00:02Z',
      ssid: 'office',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('drops a pending lifecycle event after the freshness TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T10:00:00Z'));
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopLifecycle } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;

    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: '2026-08-19T10:00:00Z',
    });

    vi.setSystemTime(new Date('2026-08-19T10:03:00Z'));
    const listener = vi.fn();
    subscribeDesktopLifecycle(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies a late bridge-ready waiter exactly once', async () => {
    const transport = installTransport();
    const { initializeDesktopBridge, subscribeDesktopBridgeReady } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    const waiter = vi.fn();
    const unsubscribe = subscribeDesktopBridgeReady(waiter);
    expect(waiter).not.toHaveBeenCalled();

    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;
    expect(waiter).toHaveBeenCalledTimes(1);

    unsubscribe();
    const alreadyReady = vi.fn();
    subscribeDesktopBridgeReady(alreadyReady);
    expect(alreadyReady).toHaveBeenCalledTimes(1);
  });

  it('opens only a strict compose route and resolves the native window status', async () => {
    const transport = installTransport();
    const {
      initializeDesktopBridge,
      requestDesktopMailComposeWindow,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;
    transport.emit({
      type: 'desktop.capabilities',
      version: 1,
      capabilities: ['mail-compose-window'],
    });

    await expect(requestDesktopMailComposeWindow('/mail/compose?draft_id=draft-1#unsafe'))
      .resolves.toEqual({ status: 'failed' });
    await expect(requestDesktopMailComposeWindow('/mail/compose?draft_id=one&draft_id=two'))
      .resolves.toEqual({ status: 'failed' });

    const pending = requestDesktopMailComposeWindow('/mail/compose?draft_id=draft-1&mailbox_id=mb-1');
    const openMessage = transport.postMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'mail.composeWindow.open');
    expect(openMessage).toMatchObject({
      version: 1,
      route: '/mail/compose?draft_id=draft-1&mailbox_id=mb-1',
    });
    transport.emit({
      type: 'mail.composeWindow.result',
      version: 1,
      requestId: openMessage.requestId,
      status: 'opened',
    });
    await expect(pending).resolves.toEqual({ status: 'opened' });
  });

  it('completes the native close handshake and dispatches compose completion', async () => {
    const transport = installTransport();
    const {
      DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT,
      completeDesktopMailComposeClose,
      initializeDesktopBridge,
      subscribeDesktopMailComposeCloseRequested,
    } = await import('./desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({ type: 'desktop.hostReady', version: 1, capabilities: { notifications: true } });
    await initialization;

    const closeListener = vi.fn();
    const completedListener = vi.fn();
    const unsubscribe = subscribeDesktopMailComposeCloseRequested(closeListener);
    window.addEventListener(DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT, completedListener);

    transport.emit({
      type: 'mail.composeWindow.closeRequested',
      version: 1,
      requestId: 'close-1',
    });
    expect(closeListener).toHaveBeenCalledWith('close-1');
    expect(completeDesktopMailComposeClose('close-1', { saved: true })).toBe(true);
    expect(transport.postMessage).toHaveBeenLastCalledWith({
      type: 'mail.composeWindow.closeResult',
      version: 1,
      requestId: 'close-1',
      status: 'saved',
    });
    expect(completeDesktopMailComposeClose('bad request', { saved: true })).toBe(false);

    transport.emit({ type: 'mail.composeWindow.completed', version: 1 });
    expect(completedListener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.removeEventListener(DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT, completedListener);
  });
});

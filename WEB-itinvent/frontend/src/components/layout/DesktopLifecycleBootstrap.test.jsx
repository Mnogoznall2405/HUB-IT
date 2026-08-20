import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  user: { id: 7, username: 'tester' },
  refreshSession: vi.fn(async () => ({ id: 7 })),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authMocks.user,
    isAuthenticated: () => Boolean(authMocks.user),
    refreshSession: (...args) => authMocks.refreshSession(...args),
  }),
}));

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

describe('DesktopLifecycleBootstrap late hostReady', () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.refreshSession.mockClear();
    authMocks.user = { id: 7, username: 'tester' };
    document.documentElement.removeAttribute('data-desktop-shell');
    delete window.chrome;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.chrome;
    document.documentElement.removeAttribute('data-desktop-shell');
  });

  it('subscribes after a late hostReady and handles resume once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T10:00:00Z'));
    const transport = installTransport();
    const { initializeDesktopBridge } = await import('../../lib/desktopBridge');
    const initialization = initializeDesktopBridge();
    const { default: DesktopLifecycleBootstrap } = await import('./DesktopLifecycleBootstrap');

    const { unmount } = render(<DesktopLifecycleBootstrap />);
    await act(async () => Promise.resolve());
    expect(authMocks.refreshSession).not.toHaveBeenCalled();

    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await act(async () => {
      await initialization;
    });

    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: '2026-08-19T10:00:00Z',
    });
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(authMocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(authMocks.refreshSession).toHaveBeenCalledWith({ suppressAuthRequired: true });

    unmount();
    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 13,
      occurredUtc: '2026-08-19T10:00:01Z',
    });
    await act(async () => Promise.resolve());
    expect(authMocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not attach if unmounted before hostReady', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T10:00:00Z'));
    const transport = installTransport();
    const { initializeDesktopBridge } = await import('../../lib/desktopBridge');
    const initialization = initializeDesktopBridge();
    const { default: DesktopLifecycleBootstrap } = await import('./DesktopLifecycleBootstrap');
    const { unmount } = render(<DesktopLifecycleBootstrap />);
    await act(async () => Promise.resolve());
    unmount();

    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await act(async () => {
      await initialization;
    });
    transport.emit({
      type: 'desktop.system.resume',
      version: 1,
      generation: 12,
      occurredUtc: '2026-08-19T10:00:00Z',
    });
    await act(async () => Promise.resolve());
    expect(authMocks.refreshSession).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUserMock = vi.fn();

vi.mock('../api/client', () => ({
  authAPI: {
    getCurrentUser: (...args) => getCurrentUserMock(...args),
    logout: vi.fn(),
  },
}));

vi.mock('../lib/mailRecentCache', () => ({
  clearAllMailRecentCache: vi.fn(),
}));

vi.mock('../lib/chatNotifications', () => ({
  disableChatPushSubscription: vi.fn(),
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

describe('desktop lifecycle auth singleflight', () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    localStorage.clear();
    window.history.pushState({}, '', '/dashboard');
    delete window.chrome;
    document.documentElement.removeAttribute('data-desktop-shell');
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.chrome;
  });

  it('does not start a second refresh when browser online and native available=true overlap', async () => {
    const occurredUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    getCurrentUserMock.mockResolvedValueOnce({ id: 7, username: 'cached', role: 'operator' });
    localStorage.setItem('user', JSON.stringify({ id: 7, username: 'cached', role: 'operator' }));

    const transport = installTransport();
    const { initializeDesktopBridge } = await import('../lib/desktopBridge');
    const initialization = initializeDesktopBridge();
    transport.emit({
      type: 'desktop.hostReady',
      version: 1,
      capabilities: { notifications: true },
    });
    await initialization;

    const { AuthProvider } = await import('../contexts/AuthContext');
    const { default: DesktopLifecycleBootstrap } = await import(
      '../components/layout/DesktopLifecycleBootstrap'
    );

    render(
      <AuthProvider>
        <DesktopLifecycleBootstrap />
      </AuthProvider>,
    );

    await waitFor(() => expect(getCurrentUserMock).toHaveBeenCalledTimes(1));
    await act(async () => Promise.resolve());

    let resolveSecond;
    getCurrentUserMock.mockImplementation(() => new Promise((resolve) => {
      resolveSecond = resolve;
    }));

    act(() => {
      fireEvent(window, new Event('online'));
      transport.emit({
        type: 'desktop.network.changed',
        version: 1,
        generation: 13,
        available: true,
        occurredUtc,
      });
    });

    expect(getCurrentUserMock).toHaveBeenCalledTimes(2);
    expect(getCurrentUserMock).toHaveBeenNthCalledWith(1, { suppressAuthRequired: true });
    expect(getCurrentUserMock).toHaveBeenNthCalledWith(2, { suppressAuthRequired: true });
    resolveSecond({ id: 7, username: 'cached', role: 'operator' });
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    expect(getCurrentUserMock).toHaveBeenCalledTimes(2);
  });
});

// Unit test: the WebView2 bridge is unavailable in Playwright, so foreground
// reporting cadence (initial report, Alt-Tab debounce, refresh only while in
// the foreground) can only be checked here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ ready: true, foreground: true }));

vi.mock('./chatSocket', () => ({ chatSocket: { reportClientState: vi.fn() } }));
vi.mock('./desktopBridge', () => ({
  DESKTOP_WINDOW_STATE_CHANGED_EVENT: 'test:desktop-window-state',
  getDesktopWindowForeground: () => bridge.foreground,
  isDesktopBridgeReady: () => bridge.ready,
  subscribeDesktopBridgeReady: () => () => {},
}));

import { startChatDesktopClientStateReporting } from './chatDesktopClientState';

describe('startChatDesktopClientStateReporting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bridge.ready = true;
    bridge.foreground = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports on start, debounces window changes and refreshes only in the foreground', () => {
    const socket = { reportClientState: vi.fn() };
    const stop = startChatDesktopClientStateReporting({ socket, refreshMs: 40_000, debounceMs: 500 });
    expect(socket.reportClientState).toHaveBeenLastCalledWith({ clientKind: 'desktop', foreground: true });

    bridge.foreground = false;
    window.dispatchEvent(new CustomEvent('test:desktop-window-state'));
    window.dispatchEvent(new CustomEvent('test:desktop-window-state'));
    vi.advanceTimersByTime(500);
    expect(socket.reportClientState).toHaveBeenCalledTimes(2);
    expect(socket.reportClientState).toHaveBeenLastCalledWith({ clientKind: 'desktop', foreground: false });

    vi.advanceTimersByTime(80_000);
    expect(socket.reportClientState).toHaveBeenCalledTimes(2);

    bridge.foreground = true;
    vi.advanceTimersByTime(40_000);
    expect(socket.reportClientState).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(120_000);
    expect(socket.reportClientState).toHaveBeenCalledTimes(3);
  });

  it('does nothing in a plain browser', () => {
    bridge.ready = false;
    const socket = { reportClientState: vi.fn() };
    const stop = startChatDesktopClientStateReporting({ socket });
    vi.advanceTimersByTime(120_000);
    expect(socket.reportClientState).not.toHaveBeenCalled();
    stop();
  });
});

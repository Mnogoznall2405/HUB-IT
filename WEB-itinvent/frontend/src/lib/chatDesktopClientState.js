import { chatSocket } from './chatSocket';
import {
  DESKTOP_WINDOW_STATE_CHANGED_EVENT,
  getDesktopWindowForeground,
  isDesktopBridgeReady,
  subscribeDesktopBridgeReady,
} from './desktopBridge';

// Server keeps the user "desktop-active" for CHAT_DESKTOP_ACTIVE_WINDOW_SEC
// (default 120 s, minimum 60 s) after the last foreground report.
export const DESKTOP_CLIENT_STATE_REFRESH_MS = 40_000;
// Alt-Tab bursts collapse into one report.
export const DESKTOP_CLIENT_STATE_DEBOUNCE_MS = 500;

/**
 * HUB Desktop only: tells the chat server whether the desktop window is in the
 * foreground, so browser tabs and browser Web Push stay silent while the
 * desktop shows its own notifications. No-op in a plain browser.
 */
export function startChatDesktopClientStateReporting({
  socket = chatSocket,
  refreshMs = DESKTOP_CLIENT_STATE_REFRESH_MS,
  debounceMs = DESKTOP_CLIENT_STATE_DEBOUNCE_MS,
} = {}) {
  if (typeof window === 'undefined') return () => {};
  let stopped = false;
  let attached = false;
  let refreshTimer = null;
  let debounceTimer = null;
  let unsubscribeReady = null;

  const report = () => {
    if (stopped) return;
    socket.reportClientState({
      clientKind: 'desktop',
      foreground: getDesktopWindowForeground() === true,
    });
  };

  const handleWindowStateChanged = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      report();
    }, debounceMs);
  };

  const attach = () => {
    if (stopped || attached) return;
    attached = true;
    report();
    window.addEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, handleWindowStateChanged);
    refreshTimer = window.setInterval(() => {
      if (getDesktopWindowForeground() === true) report();
    }, refreshMs);
  };

  if (isDesktopBridgeReady()) {
    attach();
  } else {
    unsubscribeReady = subscribeDesktopBridgeReady(attach);
  }

  return () => {
    stopped = true;
    if (typeof unsubscribeReady === 'function') unsubscribeReady();
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (debounceTimer) window.clearTimeout(debounceTimer);
    window.removeEventListener(DESKTOP_WINDOW_STATE_CHANGED_EVENT, handleWindowStateChanged);
  };
}

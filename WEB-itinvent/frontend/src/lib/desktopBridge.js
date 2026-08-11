export const DESKTOP_BRIDGE_PROTOCOL_VERSION = 1;

const READY_MESSAGE_TYPE = 'desktop.ready';
const HOST_READY_MESSAGE_TYPE = 'desktop.hostReady';
const SHOW_NOTIFICATION_MESSAGE_TYPE = 'notification.show';
const SET_THEME_MESSAGE_TYPE = 'appearance.theme';
const OPEN_DOWNLOADED_FILE_MESSAGE_TYPE = 'file.openDownloaded';
const OPEN_NAVIGATION_MESSAGE_TYPE = 'navigation.open';
const WINDOW_STATE_MESSAGE_TYPE = 'desktop.windowState';
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1000;
const MAXIMUM_INBOUND_MESSAGE_LENGTH = 4096;
const MAXIMUM_NOTIFICATION_ID_LENGTH = 128;
const MAXIMUM_NOTIFICATION_TITLE_LENGTH = 128;
const MAXIMUM_NOTIFICATION_BODY_LENGTH = 512;
const MAXIMUM_ROUTE_LENGTH = 1024;
const MAXIMUM_WINDOWS_USERNAME_LENGTH = 50;
const NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;

let bridgeReady = false;
let notificationCapabilityAvailable = false;
let initializationPromise = null;
let pendingNavigationRoute = null;
let desktopWindowForeground = true;
let desktopWindowsUsername = '';
const navigationListeners = new Set();

export const DESKTOP_WINDOW_STATE_CHANGED_EVENT = 'itinvent:desktop-window-state-changed';

const getWebViewTransport = () => {
  if (typeof window === 'undefined') return null;
  const transport = window.chrome?.webview;
  if (typeof transport?.postMessage !== 'function') return null;
  if (typeof transport?.addEventListener !== 'function') return null;
  return transport;
};

const isValidHostReadyMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  if (
    (keys.length !== 3 && keys.length !== 4)
    || !keys.includes('type')
    || !keys.includes('version')
    || !keys.includes('capabilities')
  ) return false;
  if (
    keys.length === 4
    && (
      !keys.includes('windowsUsername')
      || (message.windowsUsername !== null
        && !isValidBoundedText(message.windowsUsername, MAXIMUM_WINDOWS_USERNAME_LENGTH))
    )
  ) return false;
  const capabilities = message.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return false;
  const capabilityKeys = Object.keys(capabilities);
  if (
    capabilityKeys.length !== 1
    || capabilityKeys[0] !== 'notifications'
    || typeof capabilities.notifications !== 'boolean'
  ) return false;
  return message.type === HOST_READY_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION;
};

const isValidBoundedText = (value, maximumLength) => (
  typeof value === 'string'
  && value.trim().length > 0
  && value.length <= maximumLength
  && !CONTROL_CHARACTER_PATTERN.test(value)
);

const isValidRoute = (route) => (
  isValidBoundedText(route, MAXIMUM_ROUTE_LENGTH)
  && route.startsWith('/')
  && !route.startsWith('//')
  && !route.includes('\\')
);

const isValidOpenNavigationMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 3
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('route')
    && message.type === OPEN_NAVIGATION_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && isValidRoute(message.route);
};

const isValidWindowStateMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 3
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('foreground')
    && message.type === WINDOW_STATE_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && typeof message.foreground === 'boolean';
};

const dispatchDesktopNavigation = (route) => {
  if (navigationListeners.size === 0) {
    pendingNavigationRoute = route;
    return;
  }

  pendingNavigationRoute = null;
  navigationListeners.forEach((listener) => listener(route));
};

export function initializeDesktopBridge({ timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS } = {}) {
  if (bridgeReady) return Promise.resolve(true);
  if (initializationPromise) return initializationPromise;

  const transport = getWebViewTransport();
  if (!transport) {
    initializationPromise = Promise.resolve(false);
    return initializationPromise;
  }

  initializationPromise = new Promise((resolve) => {
    let settled = false;
    let timeoutId;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve(value);
    };

    transport.addEventListener('message', (event) => {
      const message = event?.data;
      if (isValidHostReadyMessage(message)) {
        bridgeReady = true;
        notificationCapabilityAvailable = message.capabilities.notifications;
        desktopWindowsUsername = typeof message.windowsUsername === 'string'
          ? message.windowsUsername.trim()
          : '';
        document.documentElement?.setAttribute('data-desktop-shell', 'true');
        settle(true);
        return;
      }

      if (bridgeReady && isValidOpenNavigationMessage(message)) {
        dispatchDesktopNavigation(message.route);
        return;
      }

      if (bridgeReady && isValidWindowStateMessage(message)) {
        desktopWindowForeground = message.foreground;
        window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_STATE_CHANGED_EVENT, {
          detail: { foreground: desktopWindowForeground },
        }));
      }
    });

    timeoutId = window.setTimeout(() => settle(false), Math.max(0, timeoutMs));

    try {
      transport.postMessage({
        type: READY_MESSAGE_TYPE,
        version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      });
    } catch {
      settle(false);
    }
  });

  return initializationPromise;
}

export function isDesktopBridgeReady() {
  return bridgeReady;
}

export function isDesktopNotificationAvailable() {
  return bridgeReady && notificationCapabilityAvailable;
}

export function getDesktopWindowForeground() {
  return bridgeReady ? desktopWindowForeground : null;
}

export function getDesktopWindowsUsername() {
  return bridgeReady ? desktopWindowsUsername : '';
}

export function subscribeDesktopNavigation(listener) {
  if (typeof listener !== 'function') return () => {};

  navigationListeners.add(listener);
  if (pendingNavigationRoute) {
    const route = pendingNavigationRoute;
    pendingNavigationRoute = null;
    listener(route);
  }

  return () => {
    navigationListeners.delete(listener);
  };
}

export function showDesktopNotification({ id, title, body, route } = {}) {
  if (!isDesktopNotificationAvailable()) return false;
  if (
    !isValidBoundedText(id, MAXIMUM_NOTIFICATION_ID_LENGTH)
    || !NOTIFICATION_ID_PATTERN.test(id)
    || !isValidBoundedText(title, MAXIMUM_NOTIFICATION_TITLE_LENGTH)
    || !isValidBoundedText(body, MAXIMUM_NOTIFICATION_BODY_LENGTH)
    || !isValidRoute(route)
  ) return false;

  const message = {
    type: SHOW_NOTIFICATION_MESSAGE_TYPE,
    version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
    id,
    title,
    body,
    route,
  };
  if (JSON.stringify(message).length > MAXIMUM_INBOUND_MESSAGE_LENGTH) return false;

  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

export function syncDesktopTheme(mode) {
  if (!bridgeReady || (mode !== 'light' && mode !== 'dark')) return false;

  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage({
      type: SET_THEME_MESSAGE_TYPE,
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      mode,
    });
    return true;
  } catch {
    return false;
  }
}

export function requestDesktopOpenDownloadedFile() {
  if (!bridgeReady) return false;

  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage({
      type: OPEN_DOWNLOADED_FILE_MESSAGE_TYPE,
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
    });
    return true;
  } catch {
    return false;
  }
}

import { isPendingLifecycleEnvelopeFresh } from './desktopLifecyclePolicy';

export const DESKTOP_BRIDGE_PROTOCOL_VERSION = 1;

const READY_MESSAGE_TYPE = 'desktop.ready';
const HOST_READY_MESSAGE_TYPE = 'desktop.hostReady';
const CAPABILITIES_MESSAGE_TYPE = 'desktop.capabilities';
const SHOW_NOTIFICATION_MESSAGE_TYPE = 'notification.show';
const SHELL_STATUS_MESSAGE_TYPE = 'shell.status';
const QUICK_ROUTES_MESSAGE_TYPE = 'shell.quickRoutes';
const PRINT_CURRENT_DOCUMENT_MESSAGE_TYPE = 'document.printCurrent';
const OPEN_DOWNLOADS_MESSAGE_TYPE = 'desktop.openDownloads';
const OPEN_DIAGNOSTICS_MESSAGE_TYPE = 'desktop.openDiagnostics';
const CHECK_FOR_UPDATES_MESSAGE_TYPE = 'desktop.checkForUpdates';
const OPEN_CURRENT_IN_BROWSER_MESSAGE_TYPE = 'desktop.openCurrentInBrowser';
const SET_THEME_MESSAGE_TYPE = 'appearance.theme';
const OPEN_DOWNLOADED_FILE_MESSAGE_TYPE = 'file.openDownloaded';
const OPEN_DOWNLOADED_FILE_RESULT_MESSAGE_TYPE = 'file.openDownloadedResult';
const PREPARE_DOWNLOADED_FILE_MESSAGE_TYPE = 'file.prepareDownload';
const PREPARE_DOWNLOADED_FILE_RESULT_MESSAGE_TYPE = 'file.prepareDownloadResult';
const OPEN_NAVIGATION_MESSAGE_TYPE = 'navigation.open';
const WINDOW_STATE_MESSAGE_TYPE = 'desktop.windowState';
const SYSTEM_RESUME_MESSAGE_TYPE = 'desktop.system.resume';
const SYSTEM_NETWORK_CHANGED_MESSAGE_TYPE = 'desktop.network.changed';
const OPEN_COMMAND_PALETTE_MESSAGE_TYPE = 'command.openPalette';
const VNC_PREFLIGHT_MESSAGE_TYPE = 'remote.vncPreflight';
const VNC_PREFLIGHT_RESULT_MESSAGE_TYPE = 'remote.vncPreflightResult';
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 1000;
const OPEN_DOWNLOADED_FILE_RESULT_TIMEOUT_MS = 600;
const VNC_PREFLIGHT_RESULT_TIMEOUT_MS = 1000;
const LEGACY_OPEN_INTENT_LIFETIME_MS = 15000;
const MAXIMUM_INBOUND_MESSAGE_LENGTH = 4096;
const MAXIMUM_SYSTEM_LIFECYCLE_MESSAGE_LENGTH = 512;
const MAXIMUM_NOTIFICATION_ID_LENGTH = 128;
const MAXIMUM_NOTIFICATION_TITLE_LENGTH = 128;
const MAXIMUM_NOTIFICATION_BODY_LENGTH = 512;
const MAXIMUM_ROUTE_LENGTH = 1024;
const MAXIMUM_WINDOWS_USERNAME_LENGTH = 50;
const MAXIMUM_CAPABILITIES = 16;
const MAXIMUM_CAPABILITY_LENGTH = 64;
const MAXIMUM_SHELL_COUNTER = 9999;
const MAXIMUM_QUICK_ROUTES = 12;
const MAXIMUM_QUICK_ROUTE_ID_LENGTH = 32;
const MAXIMUM_QUICK_ROUTE_LABEL_LENGTH = 48;
const NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*$/u;
const DESKTOP_DOWNLOADED_FILE_ACTIONS = new Set(['open', 'print', 'copy', 'saveAs']);
const QUICK_ROUTE_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;

let bridgeReady = false;
let notificationCapabilityAvailable = false;
let initializationPromise = null;
let pendingNavigationRoute = null;
let desktopWindowForeground = true;
let desktopWindowsUsername = '';
let desktopCapabilities = new Set();
let pendingDesktopShellStatus = null;
let pendingDesktopQuickRoutes = null;
let pendingOpenDownloadedFileRequest = null;
let pendingPreparedDownloadRequest = null;
let pendingVncPreflightRequest = null;
let legacyOpenIntentBusyUntil = 0;
const navigationListeners = new Set();
const lifecycleListeners = new Set();
const bridgeReadyWaiters = new Set();
let pendingLifecycleEvent = null;

export const DESKTOP_WINDOW_STATE_CHANGED_EVENT = 'itinvent:desktop-window-state-changed';
export const DESKTOP_OPEN_COMMAND_PALETTE_EVENT = 'itinvent:desktop-open-command-palette';
export const DESKTOP_CAPABILITIES_CHANGED_EVENT = 'itinvent:desktop-capabilities-changed';
export const DESKTOP_SYSTEM_RESUME_EVENT = 'desktop.system.resume';
export const DESKTOP_NETWORK_CHANGED_EVENT = 'desktop.network.changed';

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

const isValidCapabilitiesMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  if (
    keys.length !== 3
    || !keys.includes('type')
    || !keys.includes('version')
    || !keys.includes('capabilities')
    || message.type !== CAPABILITIES_MESSAGE_TYPE
    || message.version !== DESKTOP_BRIDGE_PROTOCOL_VERSION
    || !Array.isArray(message.capabilities)
    || message.capabilities.length > MAXIMUM_CAPABILITIES
  ) return false;

  const uniqueCapabilities = new Set();
  for (const capability of message.capabilities) {
    if (
      typeof capability !== 'string'
      || capability.length === 0
      || capability.length > MAXIMUM_CAPABILITY_LENGTH
      || !CAPABILITY_PATTERN.test(capability)
      || uniqueCapabilities.has(capability)
    ) return false;
    uniqueCapabilities.add(capability);
  }
  return true;
};

const isValidShellCounter = (value) => (
  Number.isInteger(value)
  && value >= 0
  && value <= MAXIMUM_SHELL_COUNTER
);

const isValidShellStatus = (status) => {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  const keys = Object.keys(status);
  return keys.length === 6
    && keys.includes('authenticated')
    && keys.includes('online')
    && keys.includes('unread_total')
    && keys.includes('chat_unread')
    && keys.includes('mail_unread')
    && keys.includes('tasks_attention')
    && typeof status.authenticated === 'boolean'
    && typeof status.online === 'boolean'
    && isValidShellCounter(status.unread_total)
    && isValidShellCounter(status.chat_unread)
    && isValidShellCounter(status.mail_unread)
    && isValidShellCounter(status.tasks_attention);
};

const postDesktopShellStatus = (status) => {
  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage({
      type: SHELL_STATUS_MESSAGE_TYPE,
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      ...status,
    });
    return true;
  } catch {
    return false;
  }
};

const isValidQuickRoute = (route) => {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return false;
  const keys = Object.keys(route);
  return keys.length === 4
    && keys.includes('id')
    && keys.includes('label')
    && keys.includes('route')
    && keys.includes('badge')
    && isValidBoundedText(route.id, MAXIMUM_QUICK_ROUTE_ID_LENGTH)
    && QUICK_ROUTE_ID_PATTERN.test(route.id)
    && isValidBoundedText(route.label, MAXIMUM_QUICK_ROUTE_LABEL_LENGTH)
    && isValidRoute(route.route)
    && isValidShellCounter(route.badge);
};

const isValidQuickRoutes = (routes) => {
  if (!Array.isArray(routes) || routes.length > MAXIMUM_QUICK_ROUTES) return false;
  const ids = new Set();
  for (const route of routes) {
    if (!isValidQuickRoute(route) || ids.has(route.id)) return false;
    ids.add(route.id);
  }
  return true;
};

const postDesktopQuickRoutes = (routes) => {
  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    const message = {
      type: QUICK_ROUTES_MESSAGE_TYPE,
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      routes,
    };
    if (JSON.stringify(message).length > MAXIMUM_INBOUND_MESSAGE_LENGTH) return false;
    transport.postMessage(message);
    return true;
  } catch {
    return false;
  }
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

const isValidLifecycleGeneration = (value) => (
  Number.isInteger(value)
  && value >= 1
  && value <= 2147483647
);

const isValidOccurredUtc = (value) => (
  typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)
);

const isCompactLifecycleMessage = (message) => {
  try {
    return JSON.stringify(message).length <= MAXIMUM_SYSTEM_LIFECYCLE_MESSAGE_LENGTH;
  } catch {
    return false;
  }
};

const isValidSystemResumeMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 4
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('generation')
    && keys.includes('occurredUtc')
    && message.type === SYSTEM_RESUME_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && isValidLifecycleGeneration(message.generation)
    && isValidOccurredUtc(message.occurredUtc)
    && isCompactLifecycleMessage(message);
};

const isValidNetworkChangedMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 5
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('generation')
    && keys.includes('available')
    && keys.includes('occurredUtc')
    && message.type === SYSTEM_NETWORK_CHANGED_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && isValidLifecycleGeneration(message.generation)
    && typeof message.available === 'boolean'
    && isValidOccurredUtc(message.occurredUtc)
    && isCompactLifecycleMessage(message);
};

const normalizeLifecycleEvent = (message) => {
  if (isValidSystemResumeMessage(message)) {
    return {
      type: SYSTEM_RESUME_MESSAGE_TYPE,
      generation: message.generation,
      occurredUtc: message.occurredUtc,
      available: null,
      isRecoveryAttempt: true,
    };
  }
  if (isValidNetworkChangedMessage(message)) {
    return {
      type: SYSTEM_NETWORK_CHANGED_MESSAGE_TYPE,
      generation: message.generation,
      occurredUtc: message.occurredUtc,
      available: message.available,
      isRecoveryAttempt: message.available === true,
    };
  }
  return null;
};

const dispatchDesktopLifecycle = (event) => {
  const envelope = {
    event,
    receivedAt: Date.now(),
  };
  if (lifecycleListeners.size === 0) {
    pendingLifecycleEvent = envelope;
    return;
  }

  pendingLifecycleEvent = null;
  lifecycleListeners.forEach((listener) => listener(event));
};

const flushBridgeReadyWaiters = () => {
  const waiters = [...bridgeReadyWaiters];
  bridgeReadyWaiters.clear();
  waiters.forEach((listener) => {
    try {
      listener();
    } catch {
      // Waiters must not break the host handshake.
    }
  });
};

const isValidOpenCommandPaletteMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 2
    && keys.includes('type')
    && keys.includes('version')
    && message.type === OPEN_COMMAND_PALETTE_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION;
};

const isValidOpenDownloadedFileResultMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 3
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('status')
    && message.type === OPEN_DOWNLOADED_FILE_RESULT_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && (message.status === 'accepted' || message.status === 'busy');
};

const isValidPreparedDownloadResultMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 4
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('action')
    && keys.includes('status')
    && message.type === PREPARE_DOWNLOADED_FILE_RESULT_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && DESKTOP_DOWNLOADED_FILE_ACTIONS.has(message.action)
    && (message.status === 'accepted' || message.status === 'busy');
};

const isValidVncPreflightResultMessage = (message) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  const keys = Object.keys(message);
  return keys.length === 3
    && keys.includes('type')
    && keys.includes('version')
    && keys.includes('status')
    && message.type === VNC_PREFLIGHT_RESULT_MESSAGE_TYPE
    && message.version === DESKTOP_BRIDGE_PROTOCOL_VERSION
    && (message.status === 'available' || message.status === 'missing');
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
        flushBridgeReadyWaiters();
        return;
      }

      if (bridgeReady && isValidCapabilitiesMessage(message)) {
        desktopCapabilities = new Set(message.capabilities);
        window.dispatchEvent(new CustomEvent(DESKTOP_CAPABILITIES_CHANGED_EVENT, {
          detail: { capabilities: [...desktopCapabilities] },
        }));
        if (
          pendingDesktopShellStatus
          && desktopCapabilities.has('shell-status')
          && postDesktopShellStatus(pendingDesktopShellStatus)
        ) {
          pendingDesktopShellStatus = null;
        }
        if (
          pendingDesktopQuickRoutes
          && desktopCapabilities.has('quick-routes')
          && postDesktopQuickRoutes(pendingDesktopQuickRoutes)
        ) {
          pendingDesktopQuickRoutes = null;
        }
        return;
      }

      if (bridgeReady && isValidOpenNavigationMessage(message)) {
        dispatchDesktopNavigation(message.route);
        return;
      }

      if (bridgeReady && isValidOpenCommandPaletteMessage(message)) {
        window.dispatchEvent(new CustomEvent(DESKTOP_OPEN_COMMAND_PALETTE_EVENT));
        return;
      }

      if (bridgeReady && isValidOpenDownloadedFileResultMessage(message)) {
        const pending = pendingOpenDownloadedFileRequest;
        if (pending) {
          pendingOpenDownloadedFileRequest = null;
          window.clearTimeout(pending.timeoutId);
          pending.resolve({
            accepted: message.status === 'accepted',
            status: message.status,
          });
        }
        return;
      }

      if (bridgeReady && isValidPreparedDownloadResultMessage(message)) {
        const pending = pendingPreparedDownloadRequest;
        if (pending && pending.action === message.action) {
          pendingPreparedDownloadRequest = null;
          window.clearTimeout(pending.timeoutId);
          pending.resolve({
            accepted: message.status === 'accepted',
            status: message.status,
          });
        }
        return;
      }

      if (bridgeReady && isValidVncPreflightResultMessage(message)) {
        const pending = pendingVncPreflightRequest;
        if (pending) {
          pendingVncPreflightRequest = null;
          window.clearTimeout(pending.timeoutId);
          pending.resolve({
            available: message.status === 'available',
            status: message.status,
          });
        }
        return;
      }

      if (bridgeReady && isValidWindowStateMessage(message)) {
        desktopWindowForeground = message.foreground;
        window.dispatchEvent(new CustomEvent(DESKTOP_WINDOW_STATE_CHANGED_EVENT, {
          detail: { foreground: desktopWindowForeground },
        }));
        return;
      }

      if (bridgeReady) {
        const lifecycleEvent = normalizeLifecycleEvent(message);
        if (lifecycleEvent) {
          dispatchDesktopLifecycle(lifecycleEvent);
        }
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

export function isDesktopCapabilityAvailable(capability) {
  return bridgeReady
    && typeof capability === 'string'
    && desktopCapabilities.has(capability);
}

export function syncDesktopShellStatus(status) {
  if (!isValidShellStatus(status)) return false;

  const transport = getWebViewTransport();
  if (!transport) return false;

  pendingDesktopShellStatus = status;
  if (!isDesktopCapabilityAvailable('shell-status')) return false;
  if (!postDesktopShellStatus(status)) return false;

  pendingDesktopShellStatus = null;
  return true;
}

export function syncDesktopQuickRoutes(routes) {
  if (!isValidQuickRoutes(routes)) return false;

  const transport = getWebViewTransport();
  if (!transport) return false;

  pendingDesktopQuickRoutes = routes;
  if (!isDesktopCapabilityAvailable('quick-routes')) return false;
  if (!postDesktopQuickRoutes(routes)) return false;

  pendingDesktopQuickRoutes = null;
  return true;
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

export function subscribeDesktopBridgeReady(listener) {
  if (typeof listener !== 'function') return () => {};
  if (bridgeReady) {
    listener();
    return () => {};
  }

  bridgeReadyWaiters.add(listener);
  return () => {
    bridgeReadyWaiters.delete(listener);
  };
}

export function subscribeDesktopLifecycle(listener) {
  if (typeof listener !== 'function') return () => {};

  lifecycleListeners.add(listener);
  if (pendingLifecycleEvent) {
    const pending = pendingLifecycleEvent;
    pendingLifecycleEvent = null;
    if (isPendingLifecycleEnvelopeFresh(pending, Date.now())) {
      listener(pending.event);
    }
  }

  return () => {
    lifecycleListeners.delete(listener);
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
  if (!bridgeReady) {
    return Promise.resolve({ accepted: false, status: 'unavailable' });
  }
  if (pendingOpenDownloadedFileRequest || Date.now() < legacyOpenIntentBusyUntil) {
    return Promise.resolve({ accepted: false, status: 'busy' });
  }

  return new Promise((resolve) => {
    try {
      const transport = getWebViewTransport();
      if (!transport) {
        resolve({ accepted: false, status: 'unavailable' });
        return;
      }

      const timeoutId = window.setTimeout(() => {
        if (!pendingOpenDownloadedFileRequest) return;
        pendingOpenDownloadedFileRequest = null;
        legacyOpenIntentBusyUntil = Date.now() + LEGACY_OPEN_INTENT_LIFETIME_MS;
        resolve({ accepted: true, status: 'legacy' });
      }, OPEN_DOWNLOADED_FILE_RESULT_TIMEOUT_MS);
      pendingOpenDownloadedFileRequest = { resolve, timeoutId };
      transport.postMessage({
        type: OPEN_DOWNLOADED_FILE_MESSAGE_TYPE,
        version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      });
    } catch {
      const pending = pendingOpenDownloadedFileRequest;
      pendingOpenDownloadedFileRequest = null;
      if (pending) window.clearTimeout(pending.timeoutId);
      resolve({ accepted: false, status: 'unavailable' });
    }
  });
}

export function requestDesktopDownloadedFileAction(action) {
  if (!DESKTOP_DOWNLOADED_FILE_ACTIONS.has(action)) {
    return Promise.resolve({ accepted: false, status: 'unsupported' });
  }
  if (action === 'open' && !isDesktopCapabilityAvailable('file-actions-v2')) {
    return requestDesktopOpenDownloadedFile();
  }
  if (!isDesktopCapabilityAvailable('file-actions-v2')) {
    return Promise.resolve({ accepted: false, status: 'unavailable' });
  }
  if (pendingPreparedDownloadRequest) {
    return Promise.resolve({ accepted: false, status: 'busy' });
  }

  return new Promise((resolve) => {
    try {
      const transport = getWebViewTransport();
      if (!transport) {
        resolve({ accepted: false, status: 'unavailable' });
        return;
      }

      const timeoutId = window.setTimeout(() => {
        if (!pendingPreparedDownloadRequest) return;
        pendingPreparedDownloadRequest = null;
        resolve({ accepted: false, status: 'unavailable' });
      }, OPEN_DOWNLOADED_FILE_RESULT_TIMEOUT_MS);
      pendingPreparedDownloadRequest = { action, resolve, timeoutId };
      transport.postMessage({
        type: PREPARE_DOWNLOADED_FILE_MESSAGE_TYPE,
        version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
        action,
      });
    } catch {
      const pending = pendingPreparedDownloadRequest;
      pendingPreparedDownloadRequest = null;
      if (pending) window.clearTimeout(pending.timeoutId);
      resolve({ accepted: false, status: 'unavailable' });
    }
  });
}

export function requestDesktopPrintCurrent() {
  if (!isDesktopCapabilityAvailable('print')) return false;

  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage({
      type: PRINT_CURRENT_DOCUMENT_MESSAGE_TYPE,
      version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
    });
    return true;
  } catch {
    return false;
  }
}

const postDesktopAction = (type) => {
  if (!isDesktopCapabilityAvailable('desktop-actions')) return false;
  try {
    const transport = getWebViewTransport();
    if (!transport) return false;
    transport.postMessage({ type, version: DESKTOP_BRIDGE_PROTOCOL_VERSION });
    return true;
  } catch {
    return false;
  }
};

export const requestDesktopOpenDownloads = () => postDesktopAction(OPEN_DOWNLOADS_MESSAGE_TYPE);
export const requestDesktopOpenDiagnostics = () => postDesktopAction(OPEN_DIAGNOSTICS_MESSAGE_TYPE);
export const requestDesktopCheckForUpdates = () => postDesktopAction(CHECK_FOR_UPDATES_MESSAGE_TYPE);
export const requestDesktopOpenCurrentInBrowser = () => postDesktopAction(OPEN_CURRENT_IN_BROWSER_MESSAGE_TYPE);

export function requestDesktopVncPreflight() {
  if (!isDesktopCapabilityAvailable('vnc-preflight')) {
    return Promise.resolve({ available: false, status: 'unavailable' });
  }
  if (pendingVncPreflightRequest) {
    return Promise.resolve({ available: false, status: 'busy' });
  }

  return new Promise((resolve) => {
    try {
      const transport = getWebViewTransport();
      if (!transport) {
        resolve({ available: false, status: 'unavailable' });
        return;
      }

      const timeoutId = window.setTimeout(() => {
        if (!pendingVncPreflightRequest) return;
        pendingVncPreflightRequest = null;
        resolve({ available: false, status: 'unavailable' });
      }, VNC_PREFLIGHT_RESULT_TIMEOUT_MS);
      pendingVncPreflightRequest = { resolve, timeoutId };
      transport.postMessage({
        type: VNC_PREFLIGHT_MESSAGE_TYPE,
        version: DESKTOP_BRIDGE_PROTOCOL_VERSION,
      });
    } catch {
      const pending = pendingVncPreflightRequest;
      pendingVncPreflightRequest = null;
      if (pending) window.clearTimeout(pending.timeoutId);
      resolve({ available: false, status: 'unavailable' });
    }
  });
}

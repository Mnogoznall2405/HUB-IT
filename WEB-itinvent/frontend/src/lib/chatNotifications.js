import { settingsAPI } from '../api/client';
import { getBrowserNotificationPermission, isBrowserNotificationSupported, requestBrowserNotificationPermission } from './windowsNotifications';

export const CHAT_NOTIFICATIONS_ENABLED_KEY = 'itinvent_chat_notifications_enabled';
export const CHAT_NOTIFICATION_SHOWN_KEY = 'itinvent_chat_notification_shown_ids';
export const CHAT_NOTIFICATIONS_CHANGED_EVENT = 'itinvent:chat-notifications-changed';
export const CHAT_PUSH_DIAGNOSTICS_KEY = 'itinvent_chat_push_diagnostics';
export const CHAT_PUSH_LAST_HARD_RESUBSCRIBE_AT_KEY = 'itinvent_chat_push_last_hard_resubscribe_at';

const MAX_SHOWN_IDS = 300;
const PUSH_SYNC_MIN_INTERVAL_MS = 60_000;
const PUSH_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const PUSH_HARD_RESUBSCRIBE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const listeners = new Set();

let pushSyncPromise = null;
let lastPushSyncCompletedAt = 0;
let pushConfigCache = {
  value: null,
  expiresAt: 0,
};

function readJsonStorage(key, fallback = null) {
  const raw = readStorage(key, '');
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    writeStorage(key, JSON.stringify(value));
  } catch {
    // Ignore JSON persistence failures.
  }
}

const readPushDiagnostics = () => {
  const stored = readJsonStorage(CHAT_PUSH_DIAGNOSTICS_KEY, {});
  return stored && typeof stored === 'object' ? stored : {};
};

let runtimeState = {
  pushConfigured: false,
  pushSubscribed: false,
  lastEndpoint: '',
  lastError: '',
  foregroundDiagnostic: '',
  socketStatus: '',
  ...readPushDiagnostics(),
};

function readStorage(key, fallback = '') {
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures.
  }
}

function readCachedPushConfig() {
  if (pushConfigCache.value && Number(pushConfigCache.expiresAt || 0) > Date.now()) {
    return pushConfigCache.value;
  }
  pushConfigCache = {
    value: null,
    expiresAt: 0,
  };
  return null;
}

function writeCachedPushConfig(value) {
  pushConfigCache = {
    value: value || null,
    expiresAt: Date.now() + PUSH_CONFIG_CACHE_TTL_MS,
  };
  return pushConfigCache.value;
}

function readLastHardResubscribeAt() {
  return Number(readStorage(CHAT_PUSH_LAST_HARD_RESUBSCRIBE_AT_KEY, '0')) || 0;
}

function writeLastHardResubscribeAt(value = Date.now()) {
  writeStorage(CHAT_PUSH_LAST_HARD_RESUBSCRIBE_AT_KEY, String(Number(value || Date.now()) || Date.now()));
}

function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const platform = String(navigator.platform || '').toLowerCase();
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  return /iphone|ipad|ipod/.test(ua) || (platform === 'macintel' && maxTouchPoints > 1);
}

function isAndroidLike() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(String(navigator.userAgent || ''));
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true,
  );
}

function getUserAgent() {
  if (typeof navigator === 'undefined') return '';
  return String(navigator.userAgent || '').trim();
}

function detectBrowserFamily() {
  const ua = getUserAgent();
  if (!ua) return 'unknown';
  if (/YaBrowser/i.test(ua)) return 'yandex';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\//i.test(ua)) return 'opera';
  if (/CriOS/i.test(ua) || /Chrome\//i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|YaBrowser/i.test(ua)) return 'safari';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  return 'other';
}

function isPushSupported() {
  return typeof window !== 'undefined'
    && Boolean(window.isSecureContext)
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function isChatNotificationsEnabled() {
  return readStorage(CHAT_NOTIFICATIONS_ENABLED_KEY, '1') === '1';
}

function readShownIds() {
  try {
    const parsed = JSON.parse(readStorage(CHAT_NOTIFICATION_SHOWN_KEY, '[]'));
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function persistShownIds(ids) {
  writeStorage(CHAT_NOTIFICATION_SHOWN_KEY, JSON.stringify(ids.slice(-MAX_SHOWN_IDS)));
}

function hasShownMessageNotification(messageId) {
  const normalized = String(messageId || '').trim();
  if (!normalized) return false;
  return readShownIds().includes(`chat:${normalized}`);
}

function markMessageNotificationShown(messageId) {
  const normalized = String(messageId || '').trim();
  if (!normalized) return false;
  const token = `chat:${normalized}`;
  const ids = readShownIds();
  if (ids.includes(token)) return false;
  ids.push(token);
  persistShownIds(ids);
  return true;
}

function getSnapshot() {
  const permission = getBrowserNotificationPermission();
  const supported = isBrowserNotificationSupported();
  const ios = isIosLike();
  const android = isAndroidLike();
  const standalone = isStandalone();
  const secure = typeof window === 'undefined' ? true : Boolean(window.isSecureContext);
  const browserFamily = detectBrowserFamily();
  const yandexLimited = browserFamily === 'yandex';
  const pushSupported = isPushSupported();
  const requiresInstalledPwa = ios && !standalone;
  let foregroundOnlyReason = '';
  if (!secure) {
    foregroundOnlyReason = 'not_secure_context';
  } else if (permission !== 'granted') {
    foregroundOnlyReason = 'permission_denied';
  } else if (requiresInstalledPwa) {
    foregroundOnlyReason = 'requires_installed_pwa';
  } else if (yandexLimited) {
    foregroundOnlyReason = 'yandex_limited';
  } else if (!pushSupported) {
    foregroundOnlyReason = 'push_unsupported';
  } else if (!runtimeState.pushConfigured) {
    foregroundOnlyReason = 'server_not_configured';
  }
  const backgroundCapable = supported
    && secure
    && permission === 'granted'
    && pushSupported
    && !requiresInstalledPwa
    && !yandexLimited
    && runtimeState.pushConfigured;
  const foregroundDiagnostic = String(runtimeState.foregroundDiagnostic || '').trim()
    || (
      runtimeState.socketStatus
      && runtimeState.socketStatus !== 'connected'
      ? 'chat_socket_unavailable'
      : ''
    );
  return {
    supported,
    permission,
    enabled: isChatNotificationsEnabled(),
    secure,
    ios,
    android,
    mobile: ios || android,
    standalone,
    browserFamily,
    yandexLimited,
    pushSupported,
    requiresInstalledPwa,
    pushBlockedByBrowserPolicy: yandexLimited,
    pushConfigured: Boolean(runtimeState.pushConfigured),
    pushSubscribed: Boolean(runtimeState.pushSubscribed),
    backgroundCapable,
    foregroundCapable: supported && permission === 'granted',
    lastError: runtimeState.lastError || '',
    foregroundOnlyReason,
    foregroundDiagnostic,
    socketStatus: String(runtimeState.socketStatus || '').trim() || 'unknown',
    lastPushStage: String(runtimeState.lastPushStage || '').trim(),
    lastPushStageAt: String(runtimeState.lastPushStageAt || '').trim(),
    lastDeliveryMode: String(runtimeState.lastDeliveryMode || '').trim(),
    lastPushReceivedAt: String(runtimeState.lastPushReceivedAt || '').trim(),
    lastNotificationShownAt: String(runtimeState.lastNotificationShownAt || '').trim(),
    lastBackgroundConfirmedAt: String(runtimeState.lastBackgroundConfirmedAt || '').trim(),
    lastDiagnosticTag: String(runtimeState.lastDiagnosticTag || '').trim(),
    serviceWorkerVersion: String(runtimeState.serviceWorkerVersion || '').trim(),
    pendingResubscribe: Boolean(runtimeState.pendingResubscribe),
  };
}

function emitChange() {
  const snapshot = getSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Chat notification listener failed', error);
    }
  });
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CHAT_NOTIFICATIONS_CHANGED_EVENT, { detail: snapshot }));
  }
}

function persistPushDiagnostics() {
  writeJsonStorage(CHAT_PUSH_DIAGNOSTICS_KEY, {
    lastPushStage: runtimeState.lastPushStage || '',
    lastPushStageAt: runtimeState.lastPushStageAt || '',
    lastDeliveryMode: runtimeState.lastDeliveryMode || '',
    lastPushReceivedAt: runtimeState.lastPushReceivedAt || '',
    lastNotificationShownAt: runtimeState.lastNotificationShownAt || '',
    lastBackgroundConfirmedAt: runtimeState.lastBackgroundConfirmedAt || '',
    lastDiagnosticTag: runtimeState.lastDiagnosticTag || '',
    serviceWorkerVersion: runtimeState.serviceWorkerVersion || '',
    pendingResubscribe: Boolean(runtimeState.pendingResubscribe),
  });
}

export function requestChatPushSyncDrain() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => {
      const target = registration?.active || navigator.serviceWorker.controller;
      target?.postMessage?.({ type: 'itinvent:push-sync-drain' });
    })
    .catch(() => {
      // Ignore worker drain failures.
    });
}

export function applyChatPushDiagnostic(message = {}) {
  const stage = String(message?.stage || '').trim() || String(message?.detail?.stage || '').trim();
  if (!stage) return getSnapshot();
  const detail = message?.detail && typeof message.detail === 'object' ? message.detail : {};
  const ts = String(message?.ts || new Date().toISOString()).trim() || new Date().toISOString();
  const swVersion = String(message?.sw_version || detail?.sw_version || '').trim();
  const deliveryMode = String(detail?.delivery_mode || '').trim();
  runtimeState = {
    ...runtimeState,
    lastPushStage: stage,
    lastPushStageAt: ts,
    serviceWorkerVersion: swVersion || runtimeState.serviceWorkerVersion || '',
    pendingResubscribe: stage === 'sw_pushsubscriptionchange_failed'
      ? true
      : stage === 'sw_pushsubscriptionchange_success' || stage === 'sw_pending_sync_flushed'
        ? false
        : runtimeState.pendingResubscribe,
    lastDeliveryMode: deliveryMode || runtimeState.lastDeliveryMode || '',
    lastDiagnosticTag: String(detail?.tag || runtimeState.lastDiagnosticTag || '').trim(),
    lastPushReceivedAt: stage === 'sw_push_received' ? ts : runtimeState.lastPushReceivedAt || '',
    lastNotificationShownAt: stage === 'sw_show_notification_success' ? ts : runtimeState.lastNotificationShownAt || '',
    lastBackgroundConfirmedAt:
      (stage === 'sw_push_received' || stage === 'sw_show_notification_success') && deliveryMode === 'background'
        ? ts
        : runtimeState.lastBackgroundConfirmedAt || '',
  };
  persistPushDiagnostics();
  emitChange();
  return getSnapshot();
}

function urlBase64ToUint8Array(base64String) {
  const padded = `${String(base64String || '').trim()}${'='.repeat((4 - (String(base64String || '').trim().length % 4 || 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(padded);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getCurrentPushSubscription() {
  if (!isPushSupported()) return { registration: null, subscription: null };
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return { registration, subscription };
  } catch {
    return { registration: null, subscription: null };
  }
}

export function getChatNotificationState() {
  return getSnapshot();
}

export function subscribeChatNotificationState(listener) {
  listeners.add(listener);
  listener(getSnapshot());
  return () => listeners.delete(listener);
}

export function refreshChatNotificationState() {
  emitChange();
}

export function setChatForegroundDiagnostic(reason = '') {
  const normalizedReason = String(reason || '').trim();
  if ((runtimeState.foregroundDiagnostic || '') === normalizedReason) return getSnapshot();
  runtimeState = {
    ...runtimeState,
    foregroundDiagnostic: normalizedReason,
  };
  emitChange();
  return getSnapshot();
}

export function setChatSocketStatus(status = '') {
  const normalizedStatus = String(status || '').trim() || 'unknown';
  if ((runtimeState.socketStatus || '') === normalizedStatus) return getSnapshot();
  runtimeState = {
    ...runtimeState,
    socketStatus: normalizedStatus,
  };
  emitChange();
  return getSnapshot();
}

export function setChatNotificationsEnabled(enabled) {
  writeStorage(CHAT_NOTIFICATIONS_ENABLED_KEY, enabled ? '1' : '0');
  emitChange();
  return Boolean(enabled);
}

export async function requestChatNotificationPermission() {
  const result = await requestBrowserNotificationPermission();
  emitChange();
  return result;
}

export function buildChatNotificationRoute({ conversationId, messageId } = {}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedConversationId) return '/chat';
  const query = new URLSearchParams();
  query.set('conversation', normalizedConversationId);
  if (normalizedMessageId) {
    query.set('message', normalizedMessageId);
  }
  return `/chat?${query.toString()}`;
}

export function createChatSystemNotification({ messageId, title, body, conversationId, onNavigate } = {}) {
  const normalizedMessageId = String(messageId || '').trim();
  const normalizedConversationId = String(conversationId || '').trim();
  if (!normalizedMessageId || !normalizedConversationId) return null;
  const state = getSnapshot();
  if (!state.enabled || state.permission !== 'granted' || !state.supported) return null;
  if (hasShownMessageNotification(normalizedMessageId)) return null;

  try {
    const notification = new window.Notification(String(title || 'Новое сообщение').trim() || 'Новое сообщение', {
      body: String(body || 'Откройте чат, чтобы посмотреть сообщение.').trim() || 'Откройте чат, чтобы посмотреть сообщение.',
      tag: `chat:${normalizedMessageId}`,
      renotify: false,
      icon: '/pwa-192.png',
    });
    markMessageNotificationShown(normalizedMessageId);
    notification.onclick = () => {
      try {
        notification.close?.();
      } catch {
        // Ignore close failures.
      }
      try {
        window.focus?.();
      } catch {
        // Ignore focus failures.
      }
      if (typeof onNavigate === 'function') {
        onNavigate(buildChatNotificationRoute({
          conversationId: normalizedConversationId,
          messageId: normalizedMessageId,
        }));
      }
    };
    return notification;
  } catch {
    return null;
  }
}

export async function disableChatPushSubscription({ removeServer = true } = {}) {
  const { registration, subscription } = await getCurrentPushSubscription();
  const endpoint = String(subscription?.endpoint || runtimeState.lastEndpoint || '').trim();

  if (removeServer && endpoint) {
    try {
      await settingsAPI.deleteNotificationPushSubscription(endpoint);
    } catch {
      // Ignore cleanup failures during logout/revocation.
    }
  }

  if (subscription) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Ignore browser unsubscribe failures.
    }
  }

  runtimeState = {
    ...runtimeState,
    pushSubscribed: false,
    lastEndpoint: '',
    lastError: '',
    pushConfigured: runtimeState.pushConfigured && Boolean(registration),
  };
  emitChange();
  return getSnapshot();
}

export async function syncChatPushSubscription({ user, force = false } = {}) {
  if (pushSyncPromise) return pushSyncPromise;

  pushSyncPromise = (async () => {
    const snapshot = getSnapshot();
    const shouldDisable = !user || !snapshot.enabled || snapshot.permission !== 'granted';
    if (
      !force
      && !shouldDisable
      && runtimeState.pushSubscribed
      && (Date.now() - Number(lastPushSyncCompletedAt || 0)) < PUSH_SYNC_MIN_INTERVAL_MS
    ) {
      return getSnapshot();
    }
    const { registration, subscription: existingSubscription } = await getCurrentPushSubscription();

    if (!snapshot.secure || !snapshot.supported || !snapshot.pushSupported || !registration) {
      runtimeState = {
        ...runtimeState,
        pushConfigured: false,
        pushSubscribed: false,
        lastEndpoint: '',
        lastError: '',
      };
      if (shouldDisable && existingSubscription) {
        await disableChatPushSubscription({ removeServer: Boolean(user) });
      } else {
        emitChange();
      }
      return getSnapshot();
    }

    requestChatPushSyncDrain();

    if (shouldDisable) {
      await disableChatPushSubscription({ removeServer: Boolean(user) });
      return getSnapshot();
    }

    let pushConfig = force ? null : readCachedPushConfig();
    try {
      if (!pushConfig) {
        pushConfig = await settingsAPI.getNotificationPushConfig({ force });
        writeCachedPushConfig(pushConfig);
      }
    } catch {
      runtimeState = {
        ...runtimeState,
        pushConfigured: false,
        pushSubscribed: false,
        lastError: 'config',
      };
      emitChange();
      return getSnapshot();
    }

    const pushConfigured = Boolean(pushConfig?.enabled && pushConfig?.vapid_public_key);
    if (snapshot.yandexLimited || snapshot.requiresInstalledPwa) {
      runtimeState = {
        ...runtimeState,
        pushConfigured,
        pushSubscribed: false,
        lastEndpoint: '',
        lastError: '',
      };
      if (existingSubscription) {
        await disableChatPushSubscription({ removeServer: Boolean(user) });
      } else {
        emitChange();
      }
      return getSnapshot();
    }

    if (!pushConfigured) {
      runtimeState = {
        ...runtimeState,
        pushConfigured: false,
        pushSubscribed: false,
        lastError: '',
      };
      emitChange();
      return getSnapshot();
    }

    const lastHardResubscribeAt = readLastHardResubscribeAt();
    const shouldHardResubscribe = Boolean(
      existingSubscription
      && (
        force
        || (
          lastHardResubscribeAt > 0
          && (Date.now() - lastHardResubscribeAt) >= PUSH_HARD_RESUBSCRIBE_INTERVAL_MS
        )
      )
    );

    let subscription = existingSubscription;
    if (shouldHardResubscribe && existingSubscription) {
      const existingEndpoint = String(existingSubscription.endpoint || '').trim();
      try {
        await settingsAPI.deleteNotificationPushSubscription(existingEndpoint);
      } catch {
        // Ignore stale endpoint cleanup failures before renewal.
      }
      try {
        await existingSubscription.unsubscribe();
      } catch {
        // Ignore browser unsubscribe failures; subscribe below may still recover.
      }
      subscription = null;
      runtimeState = {
        ...runtimeState,
        pushSubscribed: false,
        lastEndpoint: '',
      };
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfig.vapid_public_key),
      });
    }

    const serialized = subscription?.toJSON?.() || {};
    await settingsAPI.upsertNotificationPushSubscription({
      endpoint: subscription.endpoint,
      expiration_time: serialized.expirationTime ?? null,
      p256dh_key: String(serialized?.keys?.p256dh || '').trim(),
      auth_key: String(serialized?.keys?.auth || '').trim(),
      platform: typeof navigator === 'undefined' ? '' : String(navigator.platform || '').trim(),
      browser_family: detectBrowserFamily(),
      install_mode: snapshot.standalone ? 'standalone' : 'browser',
    });

    runtimeState = {
      ...runtimeState,
      pushConfigured: true,
      pushSubscribed: true,
      lastEndpoint: String(subscription.endpoint || '').trim(),
      lastError: '',
    };
    lastPushSyncCompletedAt = Date.now();
    if (shouldHardResubscribe) {
      writeLastHardResubscribeAt(lastPushSyncCompletedAt);
    } else if (existingSubscription && lastHardResubscribeAt <= 0) {
      writeLastHardResubscribeAt(lastPushSyncCompletedAt);
    }
    persistPushDiagnostics();
    requestChatPushSyncDrain();
    emitChange();
    return getSnapshot();
  })();

  try {
    return await pushSyncPromise;
  } finally {
    pushSyncPromise = null;
  }
}

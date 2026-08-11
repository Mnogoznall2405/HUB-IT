import { isDesktopNotificationAvailable, showDesktopNotification } from './desktopBridge';

export const WINDOWS_NOTIFICATIONS_ENABLED_KEY = 'itinvent_windows_notifications_enabled';
export const WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY = 'itinvent_windows_notifications_explicitly_set';
export const WINDOWS_NOTIFICATIONS_SHOWN_KEY = 'itinvent_windows_notifications_shown_ids';
export const WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY = 'itinvent_notification_permission_banner_dismissed';
export const WINDOWS_NOTIFICATIONS_CHANGED_EVENT = 'itinvent:windows-notifications-changed';

const MAX_SHOWN_NOTIFICATION_IDS = 300;
const MAIL_NOTIFICATION_TITLE_MAX = 72;
const MAIL_NOTIFICATION_BODY_MAX = 96;

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
    // Ignore storage failures in private or restricted modes.
  }
}

function normalizePermission(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'granted' || normalized === 'denied' || normalized === 'default') {
    return normalized;
  }
  return 'default';
}

function readShownNotificationIds() {
  try {
    const parsed = JSON.parse(readStorage(WINDOWS_NOTIFICATIONS_SHOWN_KEY, '[]'));
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function persistShownNotificationIds(ids) {
  writeStorage(
    WINDOWS_NOTIFICATIONS_SHOWN_KEY,
    JSON.stringify(ids.slice(-MAX_SHOWN_NOTIFICATION_IDS)),
  );
}

function truncateNotificationText(value, { fallback = '', maxLength = 120 } = {}) {
  const normalized = (String(value || '').trim() || String(fallback || '').trim())
    .replace(/[\u0000-\u001F\u007F-\u009F]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildDesktopNotificationId(prefix, value) {
  const normalizedPrefix = String(prefix || 'system').replace(/[^A-Za-z0-9._:-]/gu, '_');
  const normalizedValue = String(value || '').replace(/[^A-Za-z0-9._:-]/gu, '_');
  return `${normalizedPrefix}:${normalizedValue}`.slice(0, 128);
}

export function getMailNotificationDisplay(item) {
  const title = truncateNotificationText(item?.sender, {
    fallback: 'Новое письмо',
    maxLength: MAIL_NOTIFICATION_TITLE_MAX,
  });
  const subject = truncateNotificationText(item?.subject, {
    fallback: '(без темы)',
    maxLength: MAIL_NOTIFICATION_BODY_MAX,
  });
  const mailboxLabel = truncateNotificationText(item?.mailbox_label || item?.mailbox_email, {
    fallback: '',
    maxLength: 32,
  });
  const body = truncateNotificationText(
    mailboxLabel ? `[${mailboxLabel}] ${subject}` : subject,
    { fallback: '(без темы)', maxLength: MAIL_NOTIFICATION_BODY_MAX },
  );
  return {
    title: title || 'Новое письмо',
    body: body || '(без темы)',
  };
}

export function isBrowserNotificationSupported() {
  return typeof window !== 'undefined' && typeof window.Notification !== 'undefined';
}

export function getBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported()) return 'unsupported';
  return normalizePermission(window.Notification.permission);
}

export function isWindowsNotificationsEnabled() {
  return readStorage(WINDOWS_NOTIFICATIONS_ENABLED_KEY, '0') === '1';
}

export function hasExplicitWindowsNotificationsPreference() {
  return readStorage(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '0') === '1';
}

export function getWindowsNotificationState() {
  const desktopNotificationAvailable = isDesktopNotificationAvailable();
  return {
    supported: desktopNotificationAvailable || isBrowserNotificationSupported(),
    permission: desktopNotificationAvailable ? 'granted' : getBrowserNotificationPermission(),
    enabled: isWindowsNotificationsEnabled(),
    explicitlySet: hasExplicitWindowsNotificationsPreference(),
  };
}

export function dispatchWindowsNotificationStateChange() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(
    new CustomEvent(WINDOWS_NOTIFICATIONS_CHANGED_EVENT, {
      detail: getWindowsNotificationState(),
    }),
  );
}

export function setWindowsNotificationsEnabled(enabled) {
  writeStorage(WINDOWS_NOTIFICATIONS_ENABLED_KEY, enabled ? '1' : '0');
  writeStorage(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '1');
  dispatchWindowsNotificationStateChange();
  return Boolean(enabled);
}

export function autoEnableWindowsNotificationsIfGranted() {
  const state = getWindowsNotificationState();
  if (!state.supported || state.permission !== 'granted') return false;
  if (hasExplicitWindowsNotificationsPreference()) return false;
  writeStorage(WINDOWS_NOTIFICATIONS_ENABLED_KEY, '1');
  writeStorage(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '1');
  dispatchWindowsNotificationStateChange();
  return true;
}

export function isNotificationPermissionBannerDismissed() {
  return readStorage(WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY, '0') === '1';
}

export function setNotificationPermissionBannerDismissed(dismissed = true) {
  writeStorage(WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY, dismissed ? '1' : '0');
  return Boolean(dismissed);
}

export function clearNotificationPermissionBannerDismissed() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(WINDOWS_NOTIFICATIONS_PERMISSION_BANNER_DISMISSED_KEY);
  } catch {
    // Ignore storage failures in private or restricted modes.
  }
}

export async function requestBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported() || typeof window.Notification.requestPermission !== 'function') {
    return 'unsupported';
  }
  const result = await window.Notification.requestPermission();
  dispatchWindowsNotificationStateChange();
  return normalizePermission(result);
}

import { getTaskNotificationPath } from './taskNavigation';

export function getHubNotificationNavigateTo(item) {
  const entityType = String(item?.entity_type || '').trim().toLowerCase();
  const entityId = String(item?.entity_id || '').trim();
  if (entityType === 'task' && entityId) {
    return getTaskNotificationPath(item);
  }
  if (entityType === 'announcement' && entityId) {
    const [announcementId, commentId] = entityId.split('#', 2);
    const path = `/feed?post=${encodeURIComponent(announcementId)}`;
    return commentId ? `${path}#feed-comment-${encodeURIComponent(commentId)}` : path;
  }
  if (entityType === 'chat' && entityId) {
    const messageId = String(
      item?.message_id
      || item?.entity_message_id
      || item?.payload?.message_id
      || '',
    ).trim();
    const query = new URLSearchParams();
    query.set('conversation', entityId);
    if (messageId) {
      query.set('message', messageId);
    }
    return `/chat?${query.toString()}`;
  }
  return '/dashboard';
}

export function getHubNotificationActionLabel(item) {
  const entityType = String(item?.entity_type || '').trim().toLowerCase();
  if (entityType === 'task') return 'Открыть задачу';
  if (entityType === 'announcement') return 'Открыть публикацию';
  if (entityType === 'chat') return 'Открыть чат';
  return 'Открыть центр';
}

export function hasShownHubSystemNotification(notificationId) {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId) return false;
  return readShownNotificationIds().includes(`hub:${normalizedId}`);
}

export function markHubSystemNotificationShown(notificationId) {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId) return false;
  const token = `hub:${normalizedId}`;
  const existing = readShownNotificationIds();
  if (existing.includes(token)) return false;
  existing.push(token);
  persistShownNotificationIds(existing);
  return true;
}

export function hasShownMailSystemNotification(messageId) {
  const normalizedId = String(messageId || '').trim();
  if (!normalizedId) return false;
  return readShownNotificationIds().includes(`mail:${normalizedId}`);
}

export function markMailSystemNotificationShown(messageId) {
  const normalizedId = String(messageId || '').trim();
  if (!normalizedId) return false;
  const token = `mail:${normalizedId}`;
  const existing = readShownNotificationIds();
  if (existing.includes(token)) return false;
  existing.push(token);
  persistShownNotificationIds(existing);
  return true;
}

export function getMailSystemNotificationId(item) {
  if (typeof item === 'string' || typeof item === 'number') {
    return String(item || '').trim();
  }
  const mailboxId = String(item?.mailbox_id || item?.mailbox_email || '').trim();
  const stableMessageId = String(
    item?.internet_message_id
    || item?.message_id
    || item?.id
    || ''
  ).trim();
  if (!stableMessageId) return '';
  return mailboxId ? `${mailboxId}:${stableMessageId}` : stableMessageId;
}

export function createHubSystemNotification(item, { onNavigate } = {}) {
  const normalizedId = String(item?.id || '').trim();
  if (!normalizedId) return null;
  if (hasShownHubSystemNotification(normalizedId)) return null;

  const rawTitle = String(item?.title || '').trim();
  const rawBody = String(item?.body || '').trim();
  const title = rawTitle || 'Новое уведомление';
  const body = rawBody || rawTitle || 'Откройте центр управления для просмотра деталей.';
  const navigateTo = getHubNotificationNavigateTo(item);

  if (isDesktopNotificationAvailable() && showDesktopNotification({
    id: buildDesktopNotificationId('hub', normalizedId),
    title: truncateNotificationText(title, { fallback: 'Новое уведомление', maxLength: 128 }),
    body: truncateNotificationText(body, {
      fallback: 'Откройте HUB, чтобы посмотреть уведомление.',
      maxLength: 512,
    }),
    route: navigateTo,
  })) {
    markHubSystemNotificationShown(normalizedId);
    return { native: true, notificationId: normalizedId };
  }

  if (!isBrowserNotificationSupported()) return null;
  if (getBrowserNotificationPermission() !== 'granted') return null;

  try {
    const notification = new window.Notification(title, {
      body,
      tag: `hub:${normalizedId}`,
      renotify: false,
    });
    markHubSystemNotificationShown(normalizedId);
    notification.onclick = () => {
      try {
        notification.close?.();
      } catch {
        // Ignore notification close failures.
      }
      try {
        window.focus?.();
      } catch {
        // Ignore focus failures.
      }
      if (typeof onNavigate === 'function') {
        onNavigate(navigateTo, item);
      }
    };
    return notification;
  } catch {
    return null;
  }
}

export function createMailSystemNotification(item, { onNavigate } = {}) {
  const normalizedId = String(item?.id || '').trim();
  const notificationId = getMailSystemNotificationId(item);
  if (!normalizedId || !notificationId) return null;
  if (hasShownMailSystemNotification(notificationId)) return null;

  const { title, body } = getMailNotificationDisplay(item);
  /*
  const subject = String(item?.subject || '').trim() || 'Новое письмо';
  const preview = String(item?.body_preview || '').trim();
  const body = sender ? `${sender}${preview ? `: ${preview}` : ''}` : (preview || 'Откройте почту, чтобы посмотреть письмо.');
  */
  const routeParts = [
    `folder=${encodeURIComponent(String(item?.folder || 'inbox'))}`,
    `message=${encodeURIComponent(normalizedId)}`,
  ];
  const mailboxId = String(item?.mailbox_id || '').trim();
  if (mailboxId) {
    routeParts.push(`mailbox_id=${encodeURIComponent(mailboxId)}`);
  }
  const route = `/mail?${routeParts.join('&')}`;

  if (isDesktopNotificationAvailable() && showDesktopNotification({
    id: buildDesktopNotificationId('mail', notificationId),
    title: truncateNotificationText(title, { fallback: 'Новое письмо', maxLength: 128 }),
    body: truncateNotificationText(body, { fallback: '(без темы)', maxLength: 512 }),
    route,
  })) {
    markMailSystemNotificationShown(notificationId);
    return { native: true, notificationId };
  }

  if (!isBrowserNotificationSupported()) return null;
  if (getBrowserNotificationPermission() !== 'granted') return null;

  try {
    const notification = new window.Notification(title, {
      body,
      tag: `mail:${notificationId}`,
      renotify: false,
    });
    markMailSystemNotificationShown(notificationId);
    notification.onclick = () => {
      try {
        notification.close?.();
      } catch {
        // Ignore notification close failures.
      }
      try {
        window.focus?.();
      } catch {
        // Ignore focus failures.
      }
      if (typeof onNavigate === 'function') {
        onNavigate(route, item);
      }
    };
    return notification;
  } catch {
    return null;
  }
}

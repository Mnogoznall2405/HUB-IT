export const WINDOWS_NOTIFICATIONS_ENABLED_KEY = 'itinvent_windows_notifications_enabled';
export const WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY = 'itinvent_windows_notifications_explicitly_set';
export const WINDOWS_NOTIFICATIONS_SHOWN_KEY = 'itinvent_windows_notifications_shown_ids';
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
  const normalized = String(value || '').trim() || String(fallback || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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
  return {
    supported: isBrowserNotificationSupported(),
    permission: getBrowserNotificationPermission(),
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
  if (!isBrowserNotificationSupported()) return false;
  if (getBrowserNotificationPermission() !== 'granted') return false;
  if (hasExplicitWindowsNotificationsPreference()) return false;
  writeStorage(WINDOWS_NOTIFICATIONS_ENABLED_KEY, '1');
  writeStorage(WINDOWS_NOTIFICATIONS_EXPLICITLY_SET_KEY, '1');
  dispatchWindowsNotificationStateChange();
  return true;
}

export async function requestBrowserNotificationPermission() {
  if (!isBrowserNotificationSupported() || typeof window.Notification.requestPermission !== 'function') {
    return 'unsupported';
  }
  const result = await window.Notification.requestPermission();
  dispatchWindowsNotificationStateChange();
  return normalizePermission(result);
}

export function getHubNotificationNavigateTo(item) {
  const entityType = String(item?.entity_type || '').trim().toLowerCase();
  const entityId = String(item?.entity_id || '').trim();
  if (entityType === 'task' && entityId) {
    return `/tasks?task=${encodeURIComponent(entityId)}&task_tab=comments`;
  }
  if (entityType === 'announcement' && entityId) {
    return `/dashboard?announcement=${encodeURIComponent(entityId)}`;
  }
  if (entityType === 'chat' && entityId) {
    return `/chat?conversation=${encodeURIComponent(entityId)}`;
  }
  return '/dashboard';
}

export function getHubNotificationActionLabel(item) {
  const entityType = String(item?.entity_type || '').trim().toLowerCase();
  if (entityType === 'task') return 'Открыть задачу';
  if (entityType === 'announcement') return 'Открыть заметку';
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

export function createHubSystemNotification(item, { onNavigate } = {}) {
  const normalizedId = String(item?.id || '').trim();
  if (!normalizedId) return null;
  if (!isBrowserNotificationSupported()) return null;
  if (getBrowserNotificationPermission() !== 'granted') return null;
  if (hasShownHubSystemNotification(normalizedId)) return null;

  const rawTitle = String(item?.title || '').trim();
  const rawBody = String(item?.body || '').trim();
  const title = rawTitle || 'Новое уведомление';
  const body = rawBody || rawTitle || 'Откройте центр управления для просмотра деталей.';
  const navigateTo = getHubNotificationNavigateTo(item);

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
  if (!normalizedId) return null;
  if (!isBrowserNotificationSupported()) return null;
  if (getBrowserNotificationPermission() !== 'granted') return null;
  if (hasShownMailSystemNotification(normalizedId)) return null;

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

  try {
    const notification = new window.Notification(title, {
      body,
      tag: `mail:${normalizedId}`,
      renotify: false,
    });
    markMailSystemNotificationShown(normalizedId);
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

export const NOTIFICATION_PREFERENCES_CHANGED_EVENT = 'itinvent:notification-preferences-changed';

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  mail: true,
  tasks: true,
  task_email: true,
  announcements: true,
  chat: true,
});

export function normalizeNotificationPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    mail: Boolean(source.mail ?? DEFAULT_NOTIFICATION_PREFERENCES.mail),
    tasks: Boolean(source.tasks ?? DEFAULT_NOTIFICATION_PREFERENCES.tasks),
    task_email: Boolean(source.task_email ?? DEFAULT_NOTIFICATION_PREFERENCES.task_email),
    announcements: Boolean(source.announcements ?? DEFAULT_NOTIFICATION_PREFERENCES.announcements),
    chat: Boolean(source.chat ?? DEFAULT_NOTIFICATION_PREFERENCES.chat),
  };
}

function resolvePreferenceKey(notification) {
  const channel = String(notification?.channel || '').trim().toLowerCase();
  if (channel === 'mail') return 'mail';
  if (channel === 'task') return 'tasks';
  if (channel === 'feed') return 'announcements';
  if (channel === 'chat' || channel === 'mention') return 'chat';

  const entityType = String(notification?.entity_type || '').trim().toLowerCase();
  if (entityType === 'task') return 'tasks';
  if (entityType === 'announcement') return 'announcements';
  if (entityType === 'chat') return 'chat';
  if (entityType === 'mail') return 'mail';
  return '';
}

export function isNotificationChannelEnabled(notification, preferences) {
  const key = resolvePreferenceKey(notification);
  if (!key) return true;
  return normalizeNotificationPreferences(preferences)[key];
}

export function dispatchNotificationPreferencesChanged(preferences) {
  const normalized = normalizeNotificationPreferences(preferences);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFERENCES_CHANGED_EVENT, {
      detail: normalized,
    }));
  }
  return normalized;
}

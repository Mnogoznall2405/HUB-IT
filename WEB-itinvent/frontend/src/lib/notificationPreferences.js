export const NOTIFICATION_PREFERENCES_CHANGED_EVENT = 'itinvent:notification-preferences-changed';

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  mail: true,
  tasks: true,
  task_email: true,
  announcements: true,
  chat: true,
  chat_direct: true,
  chat_group: true,
  chat_task: true,
});

export function normalizeNotificationPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const legacyChatEnabled = Boolean(source.chat ?? DEFAULT_NOTIFICATION_PREFERENCES.chat);
  return {
    mail: Boolean(source.mail ?? DEFAULT_NOTIFICATION_PREFERENCES.mail),
    tasks: Boolean(source.tasks ?? DEFAULT_NOTIFICATION_PREFERENCES.tasks),
    task_email: Boolean(source.task_email ?? DEFAULT_NOTIFICATION_PREFERENCES.task_email),
    announcements: Boolean(source.announcements ?? DEFAULT_NOTIFICATION_PREFERENCES.announcements),
    chat: legacyChatEnabled,
    chat_direct: Boolean(source.chat_direct ?? legacyChatEnabled),
    chat_group: Boolean(source.chat_group ?? legacyChatEnabled),
    chat_task: Boolean(source.chat_task ?? legacyChatEnabled),
  };
}

export function resolveChatNotificationPreferenceKey(conversationKind) {
  const kind = String(conversationKind || '').trim().toLowerCase();
  if (kind === 'direct' || kind === 'ai') return 'chat_direct';
  if (kind === 'group') return 'chat_group';
  if (kind === 'task') return 'chat_task';
  return 'chat';
}

function resolvePreferenceKey(notification) {
  const channel = String(notification?.channel || '').trim().toLowerCase();
  if (channel === 'mail') return 'mail';
  if (channel === 'task') return 'tasks';
  if (channel === 'feed') return 'announcements';
  if (channel === 'chat_direct' || channel === 'chat_group' || channel === 'chat_task') return channel;
  if (channel === 'chat' || channel === 'mention') {
    return resolveChatNotificationPreferenceKey(
      notification?.conversation_kind || notification?.conversation?.kind,
    );
  }

  const entityType = String(notification?.entity_type || '').trim().toLowerCase();
  if (entityType === 'task') return 'tasks';
  if (entityType === 'announcement') return 'announcements';
  if (entityType === 'chat') {
    return resolveChatNotificationPreferenceKey(
      notification?.conversation_kind || notification?.conversation?.kind,
    );
  }
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

import apiClient from './client';
import * as Application from 'expo-application';
import { subscribeAccessTokenChanges } from '../auth/tokenStore';

export type NativePushRuntimeStatus = {
  enabled: boolean;
  configured: boolean;
  storage_available: boolean;
  project_id_present: boolean;
  service_account_present: boolean;
};

export type NativePushTokenStatus = {
  ok: boolean;
  registered: boolean;
  push_enabled: boolean;
  configured: boolean;
  removed: boolean;
};

export type QuietHoursPreferences = {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
};

export type NotificationPreferences = {
  user_id: number;
  channels: Record<string, boolean>;
  quiet_hours: QuietHoursPreferences;
};

export async function getNativePushRuntimeStatus(): Promise<NativePushRuntimeStatus> {
  const { data } = await apiClient.get<NativePushRuntimeStatus>('/settings/notifications/native-push-status');
  return data;
}

export async function registerNativePushToken(
  token: string,
  deviceId: string,
): Promise<NativePushTokenStatus> {
  const version = String(Application.nativeApplicationVersion || '').trim();
  const build = String(Application.nativeBuildVersion || '').trim();
  const { data } = await apiClient.put<NativePushTokenStatus>(
    '/settings/notifications/native-push-token',
    {
      token,
      platform: 'android',
      device_id: deviceId,
      app_version: [version, build && `(${build})`].filter(Boolean).join(' ') || undefined,
    },
  );
  return data;
}

export type NotificationUnreadCounts = {
  notifications_unread_total?: number;
  announcements_unread?: number;
  tasks_open_total?: number;
  tasks_open?: number;
  chat_messages_unread_total?: number;
  mail_unread?: number;
  mail_state?: string;
  [key: string]: unknown;
};

let notificationUnreadRequest: Promise<NotificationUnreadCounts> | null = null;

export function getNotificationUnreadCounts(): Promise<NotificationUnreadCounts> {
  if (!notificationUnreadRequest) {
    const request = apiClient
      .get<NotificationUnreadCounts>('/hub/notifications/unread-counts')
      .then(({ data }) => data);
    const sharedRequest = request.finally(() => {
      if (notificationUnreadRequest === sharedRequest) notificationUnreadRequest = null;
    });
    notificationUnreadRequest = sharedRequest;
  }
  return notificationUnreadRequest;
}

export type HubNotificationItem = {
  id: string;
  event_type?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  unread?: boolean | number;
  message_id?: string | null;
  entity_message_id?: string | null;
  payload?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type HubNotificationPoll = {
  items: HubNotificationItem[];
  unread_counts: NotificationUnreadCounts;
  generated_at?: string | null;
  limit: number;
  unread_only: boolean;
};

export type MailNotificationItem = {
  id: string;
  internet_message_id?: string | null;
  subject?: string | null;
  sender?: string | null;
  received_at?: string | null;
  is_read?: boolean;
  has_attachments?: boolean;
  body_preview?: string | null;
  mailbox_id?: string | null;
  mailbox_label?: string | null;
  mailbox_email?: string | null;
  [key: string]: unknown;
};

export type MailNotificationFeed = {
  items: MailNotificationItem[];
  total_unread: number;
  limit: number;
  state?: string;
  source?: string;
  as_of?: string | null;
};

export async function pollHubNotifications({
  limit = 60,
  unreadOnly = true,
}: {
  limit?: number;
  unreadOnly?: boolean;
} = {}): Promise<HubNotificationPoll> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 60)));
  const { data } = await apiClient.get<Partial<HubNotificationPoll>>('/hub/notifications/poll', {
    params: { limit: safeLimit, unread_only: Boolean(unreadOnly) },
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    unread_counts: data?.unread_counts && typeof data.unread_counts === 'object'
      ? data.unread_counts
      : {},
    generated_at: data?.generated_at || null,
    limit: Math.max(1, Number(data?.limit || safeLimit)),
    unread_only: data?.unread_only == null ? Boolean(unreadOnly) : Boolean(data.unread_only),
  };
}

export async function markHubNotificationRead(notificationId: string): Promise<void> {
  const normalizedId = String(notificationId || '').trim();
  if (!normalizedId || normalizedId.length > 8_192) {
    throw new Error('В уведомлении отсутствует идентификатор');
  }
  await apiClient.post(`/hub/notifications/${encodeURIComponent(normalizedId)}/read`);
}

export async function markAllHubNotificationsRead(): Promise<number> {
  const { data } = await apiClient.post<{ marked_count?: number }>('/hub/notifications/read-all');
  return Math.max(0, Number(data?.marked_count || 0));
}

export async function getMailNotificationFeed(limit = 20): Promise<MailNotificationFeed> {
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)));
  const { data } = await apiClient.get<Partial<MailNotificationFeed>>('/mail/notifications/feed', {
    params: { limit: safeLimit },
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total_unread: Math.max(0, Number(data?.total_unread || 0)),
    limit: Math.max(1, Number(data?.limit || safeLimit)),
    state: data?.state,
    source: data?.source,
    as_of: data?.as_of || null,
  };
}

export async function markAllMailNotificationsRead(mailboxIds: string[] = []): Promise<number> {
  const normalizedMailboxIds = [...new Set(
    (mailboxIds || []).map((value) => String(value || '').trim()).filter(Boolean),
  )];
  const targets = normalizedMailboxIds.length ? normalizedMailboxIds : [''];
  const results = await Promise.allSettled(targets.map((mailboxId) => apiClient.post<{
    marked_count?: number;
    updated?: number;
    changed?: number;
  }>('/mail/messages/mark-all-read', {
    ...(mailboxId ? { mailbox_id: mailboxId } : {}),
    folder: 'inbox',
    folder_scope: 'current',
  })));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) {
    throw new Error(`Не удалось отметить письма прочитанными в ${failed} почтовых ящиках.`);
  }
  return results.reduce((total, result) => {
    if (result.status !== 'fulfilled') return total;
    const data = result.value.data;
    return total + Math.max(0, Number(data?.marked_count || data?.updated || data?.changed || 0));
  }, 0);
}

export type MailUnreadSnapshot = {
  unread_count: number;
  state: string;
  as_of?: string | null;
};

let mailUnreadRequest: Promise<MailUnreadSnapshot> | null = null;

subscribeAccessTokenChanges(() => {
  notificationUnreadRequest = null;
  mailUnreadRequest = null;
});

export function getMailUnreadSnapshot(): Promise<MailUnreadSnapshot> {
  if (!mailUnreadRequest) {
    const request = apiClient.get<{
      unread_count?: number;
      total_unread?: number;
      state?: string;
      as_of?: string | null;
    }>('/mail/unread-count').then(({ data }) => ({
      unread_count: Math.max(0, Number(data?.unread_count || data?.total_unread || 0)),
      state: String(data?.state || 'unknown'),
      as_of: data?.as_of || null,
    }));
    const sharedRequest = request.finally(() => {
      if (mailUnreadRequest === sharedRequest) mailUnreadRequest = null;
    });
    mailUnreadRequest = sharedRequest;
  }
  return mailUnreadRequest;
}

export async function getMailUnreadCount(): Promise<number> {
  return (await getMailUnreadSnapshot()).unread_count;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data } = await apiClient.get<NotificationPreferences>('/settings/notifications/preferences');
  return data;
}

export async function updateNotificationPreferences(
  patch: Record<string, boolean>,
): Promise<NotificationPreferences> {
  const { data } = await apiClient.patch<NotificationPreferences>(
    '/settings/notifications/preferences',
    patch,
  );
  return data;
}

export async function updateQuietHours(
  quietHours: QuietHoursPreferences,
): Promise<NotificationPreferences> {
  const { data } = await apiClient.patch<NotificationPreferences>(
    '/settings/notifications/preferences',
    {
      quiet_hours_enabled: quietHours.enabled,
      quiet_hours_start: quietHours.start,
      quiet_hours_end: quietHours.end,
      quiet_hours_timezone: quietHours.timezone,
    },
  );
  return data;
}

export async function deleteNativePushToken(token: string): Promise<NativePushTokenStatus> {
  const { data } = await apiClient.delete<NativePushTokenStatus>(
    '/settings/notifications/native-push-token',
    { data: { token } },
  );
  return data;
}

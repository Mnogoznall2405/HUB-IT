import type { HubNotificationItem, MailNotificationItem } from '../api/notificationApi';

export type NotificationCenterItem = {
  key: string;
  source: 'hub' | 'mail';
  id: string;
  title: string;
  body: string;
  createdAt: string;
  unread: boolean;
  entityType: string;
  raw: HubNotificationItem | MailNotificationItem;
};

export type NotificationCenterSection = {
  title: string;
  data: NotificationCenterItem[];
};

function normalizedText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hubNotificationPortalPath(item: HubNotificationItem): string {
  const entityType = normalizedText(item.entity_type).toLowerCase();
  const entityId = normalizedText(item.entity_id);
  if (entityType === 'task' && entityId) {
    return `/tasks?task=${encodeURIComponent(entityId)}`;
  }
  if (entityType === 'announcement' && entityId) {
    const [postId, commentId] = entityId.split('#', 2);
    const base = `/feed?post=${encodeURIComponent(postId)}`;
    return commentId ? `${base}#feed-comment-${encodeURIComponent(commentId)}` : base;
  }
  if (entityType === 'chat' && entityId) {
    const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
    const messageId = normalizedText(
      item.message_id || item.entity_message_id || payload.message_id,
    );
    return `/chat?conversation=${encodeURIComponent(entityId)}${
      messageId ? `&message=${encodeURIComponent(messageId)}` : ''
    }`;
  }
  return '/dashboard';
}

export function mailNotificationPortalPath(item: MailNotificationItem): string {
  const messageId = normalizedText(item.id);
  const mailboxId = normalizedText(item.mailbox_id);
  const query = new URLSearchParams({ folder: 'inbox', message: messageId });
  if (mailboxId) query.set('mailbox_id', mailboxId);
  return `/mail?${query.toString()}`;
}

export function buildNotificationCenterItems(
  hubItems: HubNotificationItem[],
  mailItems: MailNotificationItem[],
): NotificationCenterItem[] {
  const hub = hubItems
    .map((item): NotificationCenterItem | null => {
      const id = normalizedText(item.id);
      if (!id) return null;
      const title = normalizedText(item.title) || 'Новое уведомление';
      return {
        key: `hub:${id}`,
        source: 'hub',
        id,
        title,
        body: normalizedText(item.body),
        createdAt: normalizedText(item.created_at),
        unread: item.unread === true || Number(item.unread) === 1,
        entityType: normalizedText(item.entity_type).toLowerCase(),
        raw: item,
      };
    })
    .filter((item): item is NotificationCenterItem => Boolean(item));
  const mail = mailItems
    .map((item): NotificationCenterItem | null => {
      const id = normalizedText(item.id);
      if (!id) return null;
      const sender = normalizedText(item.sender);
      const subject = normalizedText(item.subject) || '(без темы)';
      const mailbox = normalizedText(item.mailbox_label || item.mailbox_email);
      return {
        key: `mail:${normalizedText(item.mailbox_id)}:${id}`,
        source: 'mail',
        id,
        title: sender || 'Новое письмо',
        body: mailbox ? `${subject} · ${mailbox}` : subject,
        createdAt: normalizedText(item.received_at),
        unread: !Boolean(item.is_read),
        entityType: 'mail',
        raw: item,
      };
    })
    .filter((item): item is NotificationCenterItem => Boolean(item));
  return [...hub, ...mail].sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt));
}

function dayKey(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'unknown';
  return `${parsed.getFullYear()}-${parsed.getMonth()}-${parsed.getDate()}`;
}

export function notificationSectionTitle(value: string, now = new Date()): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'Ранее';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: target.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(target);
}

export function groupNotificationCenterItems(
  items: NotificationCenterItem[],
  now = new Date(),
): NotificationCenterSection[] {
  const groups = new Map<string, NotificationCenterItem[]>();
  items.forEach((item) => {
    const key = dayKey(item.createdAt);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return Array.from(groups.values()).map((data) => ({
    title: notificationSectionTitle(data[0]?.createdAt || '', now),
    data,
  }));
}

export function notificationTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

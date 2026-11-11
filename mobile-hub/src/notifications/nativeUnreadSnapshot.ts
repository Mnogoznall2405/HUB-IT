import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';
import { subscribeAccessTokenChanges } from '../auth/tokenStore';

const BOOTSTRAP_CACHE_TTL_MS = 2_500;

export type NativeUnreadSnapshot = {
  tasks_open: number;
  tasks_open_total: number;
  chat_messages_unread_total: number;
  mail_unread: number;
  mail_state: string;
  notifications_unread_total: number;
  announcements_unread: number;
  successful_sources: number;
};

type SnapshotOptions = {
  canReadChat?: boolean;
  canReadMail?: boolean;
  force?: boolean;
};

type CachedSnapshot = {
  expiresAtMs: number;
  value: NativeUnreadSnapshot;
};

const cachedSnapshots = new Map<string, CachedSnapshot>();
const pendingSnapshots = new Map<string, Promise<NativeUnreadSnapshot>>();

function safeCount(value: unknown): number {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function snapshotKey(canReadChat: boolean, canReadMail: boolean): string {
  return `${canReadChat ? 'chat' : 'no-chat'}:${canReadMail ? 'mail' : 'no-mail'}`;
}

function clearSnapshotCache(): void {
  cachedSnapshots.clear();
  pendingSnapshots.clear();
}

subscribeAccessTokenChanges(clearSnapshotCache);

export function clearNativeUnreadSnapshotCacheForTests(): void {
  clearSnapshotCache();
}

export function getNativeUnreadSnapshot({
  canReadChat = true,
  canReadMail = true,
  force = false,
}: SnapshotOptions = {}): Promise<NativeUnreadSnapshot> {
  const key = snapshotKey(canReadChat, canReadMail);
  const now = Date.now();
  const cached = cachedSnapshots.get(key);
  if (!force && cached && cached.expiresAtMs > now) return Promise.resolve(cached.value);

  const pending = pendingSnapshots.get(key);
  if (pending) return pending;

  const request = Promise.allSettled([
    notificationApi.getNotificationUnreadCounts(),
    canReadChat ? chatApi.getUnreadSummary() : Promise.resolve(null),
    canReadMail ? notificationApi.getMailUnreadSnapshot() : Promise.resolve(null),
  ]).then(([hubResult, chatResult, mailResult]) => {
    const hub = hubResult.status === 'fulfilled' ? hubResult.value : {};
    const chat = chatResult.status === 'fulfilled' ? chatResult.value : null;
    const mail = mailResult.status === 'fulfilled' ? mailResult.value : null;
    const value: NativeUnreadSnapshot = {
      tasks_open: safeCount(hub?.tasks_open || hub?.tasks_open_total),
      tasks_open_total: safeCount(hub?.tasks_open_total || hub?.tasks_open),
      chat_messages_unread_total: safeCount(
        chat?.messages_unread_total || hub?.chat_messages_unread_total,
      ),
      mail_unread: safeCount(mail?.unread_count || hub?.mail_unread),
      mail_state: String(mail?.state || hub?.mail_state || (canReadMail ? 'unknown' : 'ok')),
      notifications_unread_total: safeCount(hub?.notifications_unread_total),
      announcements_unread: safeCount(hub?.announcements_unread),
      successful_sources: Number(hubResult.status === 'fulfilled')
        + Number(canReadChat && chatResult.status === 'fulfilled')
        + Number(canReadMail && mailResult.status === 'fulfilled'),
    };
    cachedSnapshots.set(key, {
      expiresAtMs: Date.now() + BOOTSTRAP_CACHE_TTL_MS,
      value,
    });
    return value;
  });

  const sharedRequest = request.finally(() => {
    if (pendingSnapshots.get(key) === sharedRequest) pendingSnapshots.delete(key);
  });
  pendingSnapshots.set(key, sharedRequest);
  return sharedRequest;
}

export function nativeUnreadTotal(snapshot: Pick<
  NativeUnreadSnapshot,
  | 'notifications_unread_total'
  | 'announcements_unread'
  | 'mail_unread'
  | 'chat_messages_unread_total'
>): number {
  return safeCount(snapshot.notifications_unread_total)
    + safeCount(snapshot.announcements_unread)
    + safeCount(snapshot.mail_unread)
    + safeCount(snapshot.chat_messages_unread_total);
}

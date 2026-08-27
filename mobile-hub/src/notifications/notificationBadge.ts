import * as Notifications from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';

const MAX_BADGE_COUNT = 999;

function safeCount(value: unknown): number {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export async function resolveNativeUnreadCount(): Promise<number | null> {
  const results = await Promise.allSettled([
    notificationApi.getNotificationUnreadCounts().then((counts) => (
      safeCount(counts.notifications_unread_total) + safeCount(counts.announcements_unread)
    )),
    notificationApi.getMailUnreadCount(),
    chatApi.getConversations().then((items) => (
      items.reduce((total, item) => total + safeCount(item.unread_count), 0)
    )),
  ]);
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<number> => result.status === 'fulfilled',
  );
  if (!fulfilled.length) return null;
  return Math.min(MAX_BADGE_COUNT, fulfilled.reduce((total, result) => total + safeCount(result.value), 0));
}

export async function reconcileNativeBadge(): Promise<number | null> {
  const count = await resolveNativeUnreadCount();
  if (count === null) return null;
  await Notifications.setBadgeCountAsync(count).catch(() => false);
  return count;
}

export async function clearNativeBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => false);
}

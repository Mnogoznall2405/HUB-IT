import * as Notifications from 'expo-notifications';
import {
  getNativeUnreadSnapshot,
  nativeUnreadTotal,
} from './nativeUnreadSnapshot';

const MAX_BADGE_COUNT = 999;

function safeCount(value: unknown): number {
  const count = Number(value || 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export async function resolveNativeUnreadCount({ force = false }: { force?: boolean } = {}): Promise<number | null> {
  const snapshot = await getNativeUnreadSnapshot({ force });
  if (snapshot.successful_sources <= 0) return null;
  return Math.min(MAX_BADGE_COUNT, nativeUnreadTotal(snapshot));
}

export async function setNativeBadgeCount(count: number): Promise<number> {
  const normalized = Math.min(MAX_BADGE_COUNT, safeCount(count));
  await Notifications.setBadgeCountAsync(normalized).catch(() => false);
  return normalized;
}

export async function reconcileNativeBadge({ force = false }: { force?: boolean } = {}): Promise<number | null> {
  const count = await resolveNativeUnreadCount({ force });
  if (count === null) return null;
  await setNativeBadgeCount(count);
  return count;
}

export async function clearNativeBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0).catch(() => false);
}

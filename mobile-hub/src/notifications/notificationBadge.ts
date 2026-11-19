import * as Notifications from 'expo-notifications';
import { applyPendingNativeMailUnread } from '../mail/nativeMailUnreadPending';
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
  if (snapshot.successful_sources <= 0 || snapshot.badge_safe === false) return null;
  // Mail unread is eventually consistent on the server (Exchange); apply the
  // locally staged delta so a force refresh right after «mark read» does not
  // roll the badge back.
  const adjustedMailUnread = applyPendingNativeMailUnread('', null, snapshot.mail_unread);
  const total = nativeUnreadTotal(snapshot) - safeCount(snapshot.mail_unread) + adjustedMailUnread;
  return Math.min(MAX_BADGE_COUNT, Math.max(0, total));
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

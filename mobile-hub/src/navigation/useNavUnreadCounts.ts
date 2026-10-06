import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { chatSocket } from '../chat/chatSocket';
import { applyNativeMailUnreadChange, subscribeNativeMailUnread } from '../mail/nativeMailUnreadEvents';
import { applyPendingNativeMailUnread } from '../mail/nativeMailUnreadPending';
import { setNativeBadgeCount } from '../notifications/notificationBadge';
import { getNativeUnreadSnapshot, nativeUnreadTotal } from '../notifications/nativeUnreadSnapshot';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';

export const HUB_POLL_INTERVAL_MS = 20_000;
// While both sockets are connected every change already arrives as an event, so
// the poll is only a safety net and may be much rarer.
export const HUB_POLL_CONNECTED_INTERVAL_MS = 90_000;
export const HUB_REALTIME_REFRESH_DEBOUNCE_MS = 1500;

export type NavUnreadCounts = {
  tasks_open: number;
  tasks_open_total: number;
  chat_messages_unread_total: number;
  mail_unread: number;
  mail_state: string;
  notifications_unread_total: number;
  announcements_unread: number;
  [key: string]: unknown;
};

const EMPTY_COUNTS: NavUnreadCounts = {
  tasks_open: 0,
  tasks_open_total: 0,
  chat_messages_unread_total: 0,
  mail_unread: 0,
  mail_state: 'unknown',
  notifications_unread_total: 0,
  announcements_unread: 0,
};

export function useNavUnreadCounts(): NavUnreadCounts {
  const { user, hasPermission } = useAuth();
  const [counts, setCounts] = useState<NavUnreadCounts>(EMPTY_COUNTS);
  const mountedRef = useRef(true);

  const load = useCallback(async (force = false) => {
    if (!user) {
      if (mountedRef.current) setCounts(EMPTY_COUNTS);
      return;
    }
    const canReadChat = hasPermission('chat.read');
    const canReadMail = hasPermission('mail.access');
    const snapshot = await getNativeUnreadSnapshot({ canReadChat, canReadMail, force });
    if (!mountedRef.current) return;
    // Серверный счётчик почты может отставать от локально применённых дельт
    // (Exchange обновляет unread с задержкой) — корректируем до подтверждения.
    const corrected = { ...snapshot, mail_unread: applyPendingNativeMailUnread(null, null, snapshot.mail_unread) };
    setCounts(corrected);
    if (snapshot.successful_sources > 0) {
      void setNativeBadgeCount(nativeUnreadTotal(corrected));
    }
  }, [hasPermission, user]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    // Realtime bursts (busy chats, mass task updates) collapse into one refresh.
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        lastLoadAt = Date.now();
        void load(true);
      }, HUB_REALTIME_REFRESH_DEBOUNCE_MS);
    };
    let lastLoadAt = Date.now();
    const timer = setInterval(() => {
      const realtimeUp = chatSocket.getStatus() === 'connected' && hubRealtimeSocket.getStatus() === 'connected';
      if (realtimeUp && Date.now() - lastLoadAt < HUB_POLL_CONNECTED_INTERVAL_MS - 1_000) return;
      lastLoadAt = Date.now();
      void load(true);
    }, HUB_POLL_INTERVAL_MS);
    // M2: the nav badge tracks chat unread totals in realtime. The event already
    // carries the totals, so apply them directly instead of refetching three
    // endpoints (chat.conversation.updated / chat.message.created are always
    // followed by this event, and the poll below stays as a safety net).
    const offUnreadSummary = chatSocket.on('chat.unread.summary', (envelope: unknown) => {
      const payload = (envelope as { payload?: { messages_unread_total?: unknown; unread_total?: unknown } } | null)?.payload;
      const total = Number(payload?.messages_unread_total ?? payload?.unread_total);
      if (!Number.isFinite(total) || total < 0) {
        scheduleRefresh();
        return;
      }
      if (!mountedRef.current) return;
      setCounts((current) => {
        const chatTotal = Math.trunc(total);
        if (current.chat_messages_unread_total === chatTotal) return current;
        const next = { ...current, chat_messages_unread_total: chatTotal };
        void setNativeBadgeCount(nativeUnreadTotal(next));
        return next;
      });
    });
    const offHubConnected = hubRealtimeSocket.on('hub.realtime.connected', () => { void load(); });
    const offHubNotification = hubRealtimeSocket.on('hub.notification.created', scheduleRefresh);
    const offHubTasks = hubRealtimeSocket.onTaskChanged(scheduleRefresh);
    const offHubMail = hubRealtimeSocket.onMailChanged(scheduleRefresh);
    const offMailUnread = subscribeNativeMailUnread((change) => {
      if (!mountedRef.current) return;
      setCounts((current) => {
        const next = {
          ...current,
          mail_unread: applyNativeMailUnreadChange(current.mail_unread, change),
          mail_state: 'ok',
        };
        void setNativeBadgeCount(nativeUnreadTotal(next));
        return next;
      });
    });
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      if (refreshTimer) clearTimeout(refreshTimer);
      offUnreadSummary();
      offHubConnected();
      offHubNotification();
      offHubTasks();
      offHubMail();
      offMailUnread();
    };
  }, [load]);

  return counts;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { chatSocket } from '../chat/chatSocket';
import { applyNativeMailUnreadChange, subscribeNativeMailUnread } from '../mail/nativeMailUnreadEvents';
import { setNativeBadgeCount } from '../notifications/notificationBadge';
import { getNativeUnreadSnapshot, nativeUnreadTotal } from '../notifications/nativeUnreadSnapshot';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';

export const HUB_POLL_INTERVAL_MS = 20_000;

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
    setCounts(snapshot);
    if (snapshot.successful_sources > 0) {
      void setNativeBadgeCount(nativeUnreadTotal(snapshot));
    }
  }, [hasPermission, user]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const timer = setInterval(() => { void load(true); }, HUB_POLL_INTERVAL_MS);
    const offUpdated = chatSocket.on('chat.conversation.updated', () => { void load(true); });
    const offMessage = chatSocket.on('chat.message.created', () => { void load(true); });
    const offHubConnected = hubRealtimeSocket.on('hub.realtime.connected', () => { void load(); });
    const offHubNotification = hubRealtimeSocket.on('hub.notification.created', () => { void load(true); });
    const offHubTasks = hubRealtimeSocket.onTaskChanged(() => { void load(true); });
    const offHubMail = hubRealtimeSocket.onMailChanged(() => { void load(true); });
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
      offUpdated();
      offMessage();
      offHubConnected();
      offHubNotification();
      offHubTasks();
      offHubMail();
      offMailUnread();
    };
  }, [load]);

  return counts;
}

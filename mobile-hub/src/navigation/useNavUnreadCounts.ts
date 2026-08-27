import { useCallback, useEffect, useRef, useState } from 'react';
import * as chatApi from '../api/chatApi';
import * as notificationApi from '../api/notificationApi';
import { useAuth } from '../auth/AuthContext';
import { chatSocket } from '../chat/chatSocket';
import { applyNativeMailUnreadChange, subscribeNativeMailUnread } from '../mail/nativeMailUnreadEvents';

export const HUB_POLL_INTERVAL_MS = 20_000;

export type NavUnreadCounts = {
  tasks_open: number;
  tasks_open_total: number;
  chat_messages_unread_total: number;
  mail_unread: number;
  mail_state: string;
  notifications_unread_total: number;
  [key: string]: unknown;
};

const EMPTY_COUNTS: NavUnreadCounts = {
  tasks_open: 0,
  tasks_open_total: 0,
  chat_messages_unread_total: 0,
  mail_unread: 0,
  mail_state: 'unknown',
  notifications_unread_total: 0,
};

export function useNavUnreadCounts(): NavUnreadCounts {
  const { user, hasPermission } = useAuth();
  const [counts, setCounts] = useState<NavUnreadCounts>(EMPTY_COUNTS);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!user) {
      if (mountedRef.current) setCounts(EMPTY_COUNTS);
      return;
    }
    const canReadChat = hasPermission('chat.read');
    const canReadMail = hasPermission('mail.access');
    const [hubResult, chatResult, mailResult] = await Promise.allSettled([
      notificationApi.getNotificationUnreadCounts(),
      canReadChat ? chatApi.getUnreadSummary() : Promise.resolve(null),
      canReadMail ? notificationApi.getMailUnreadSnapshot() : Promise.resolve(null),
    ]);
    if (!mountedRef.current) return;
    const hub = hubResult.status === 'fulfilled' ? hubResult.value : {};
    const chat = chatResult.status === 'fulfilled' ? chatResult.value : null;
    const mail = mailResult.status === 'fulfilled' ? mailResult.value : null;
    setCounts({
      tasks_open: Number(hub?.tasks_open || hub?.tasks_open_total || 0),
      tasks_open_total: Number(hub?.tasks_open_total || hub?.tasks_open || 0),
      chat_messages_unread_total: Number(
        chat?.messages_unread_total || hub?.chat_messages_unread_total || 0,
      ),
      mail_unread: Number(mail?.unread_count || hub?.mail_unread || 0),
      mail_state: String(mail?.state || hub?.mail_state || (canReadMail ? 'unknown' : 'ok')),
      notifications_unread_total: Number(hub?.notifications_unread_total || 0),
    });
  }, [hasPermission, user]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const timer = setInterval(() => { void load(); }, HUB_POLL_INTERVAL_MS);
    const offUpdated = chatSocket.on('chat.conversation.updated', () => { void load(); });
    const offMessage = chatSocket.on('chat.message.created', () => { void load(); });
    const offMailUnread = subscribeNativeMailUnread((change) => {
      if (!mountedRef.current) return;
      setCounts((current) => ({
        ...current,
        mail_unread: applyNativeMailUnreadChange(current.mail_unread, change),
        mail_state: 'ok',
      }));
    });
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
      offUpdated();
      offMessage();
      offMailUnread();
    };
  }, [load]);

  return counts;
}

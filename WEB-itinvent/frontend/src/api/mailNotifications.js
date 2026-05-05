import apiClient, { getCachedGet } from './client';

const MAIL_UNREAD_COUNT_STALE_TIME_MS = 60_000;

const normalizeMailboxId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

export const mailNotificationsAPI = {
  getUnreadCount: async ({
    force = false,
    staleTimeMs = MAIL_UNREAD_COUNT_STALE_TIME_MS,
    mailboxId = '',
  } = {}) => {
    const normalizedMailboxId = normalizeMailboxId(mailboxId);
    if (normalizedMailboxId) {
      const response = await apiClient.get('/mail/unread-count', {
        params: { mailbox_id: normalizedMailboxId },
      });
      return response.data;
    }
    return getCachedGet(
      'mail-unread-count',
      '/mail/unread-count',
      {
        staleTimeMs,
        force,
      },
    );
  },

  getNotificationFeed: async (params = {}) => {
    const response = await apiClient.get('/mail/notifications/feed', { params });
    return response.data;
  },
};

export default mailNotificationsAPI;

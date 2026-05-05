import apiClient from './client';

const normalizeMailboxId = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const withMailboxQuery = (params = {}, mailboxId) => {
  const normalizedMailboxId = normalizeMailboxId(mailboxId ?? params?.mailbox_id ?? params?.mailboxId);
  const nextParams = { ...(params || {}) };
  delete nextParams.mailboxId;
  if (normalizedMailboxId) {
    nextParams.mailbox_id = normalizedMailboxId;
  } else {
    delete nextParams.mailbox_id;
  }
  return nextParams;
};

export const mailConversationsAPI = {
  getConversations: async (params = {}) => {
    const response = await apiClient.get('/mail/conversations', { params: withMailboxQuery(params) });
    return response.data;
  },

  getConversation: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(`/mail/conversations/${encodeURIComponent(conversationId)}`, {
      params: withMailboxQuery(params),
      signal: options?.signal,
    });
    return response.data;
  },

  markConversationAsRead: async (conversationId, payload = {}) => {
    const response = await apiClient.post(
      `/mail/conversations/${encodeURIComponent(conversationId)}/read`,
      payload,
    );
    return response.data;
  },

  markConversationAsUnread: async (conversationId, payload = {}) => {
    const response = await apiClient.post(
      `/mail/conversations/${encodeURIComponent(conversationId)}/unread`,
      payload,
    );
    return response.data;
  },
};

export default mailConversationsAPI;

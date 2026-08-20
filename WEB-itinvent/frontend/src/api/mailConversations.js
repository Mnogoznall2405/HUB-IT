import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

export const mailConversationsAPI = {
  getConversations: async (params = {}, options = {}) => {
    const response = await apiClient.get('/mail/conversations', {
      params: withMailboxQuery(params),
      ...(options?.signal ? { signal: options.signal } : {}),
    });
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

import apiClient from './client';

export const chatThreadMessagesAPI = {
  deleteChatMessage: async (conversationId, messageId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
    );
    return response.data;
  },

  getThreadBootstrap: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/thread-bootstrap`,
      {
        params,
        signal: options?.signal,
      },
    );
    return response.data;
  },

  getMessages: async (conversationId, params = {}, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        params,
        signal: options?.signal,
      },
    );
    return response.data;
  },

  searchMessages: async (conversationId, params = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/search`,
      { params },
    );
    return response.data;
  },

  getMessageReads: async (messageId) => {
    const response = await apiClient.get(`/chat/messages/${encodeURIComponent(messageId)}/reads`);
    return response.data;
  },

  markRead: async (conversationId, messageId) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
      message_id: messageId,
    });
    return response.data;
  },
};

export default chatThreadMessagesAPI;

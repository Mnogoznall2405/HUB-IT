import apiClient from './client';

export const chatConversationDetailsAPI = {
  getConversation: async (conversationId, options = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
      { signal: options?.signal },
    );
    return response.data;
  },

  updateConversationSettings: async (conversationId, payload) => {
    const response = await apiClient.patch(
      `/chat/conversations/${encodeURIComponent(conversationId)}/settings`,
      payload,
    );
    return response.data;
  },

  setPinnedMessage: async (conversationId, messageId) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/pinned-message`,
      { message_id: messageId || null },
    );
    return response.data;
  },

  deleteConversation: async (conversationId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
    );
    return response.data;
  },
};

export default chatConversationDetailsAPI;

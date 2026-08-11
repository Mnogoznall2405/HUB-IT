import apiClient from './client';

export const chatConversationsAPI = {
  getConversations: async (params = {}, options = {}) => {
    const { signal, ...query } = params || {};
    const response = await apiClient.get('/chat/conversations', {
      params: query,
      signal: signal || options.signal,
    });
    return response.data;
  },

  createDirectConversation: async (peerUserId) => {
    const response = await apiClient.post('/chat/conversations/direct', {
      peer_user_id: peerUserId,
    });
    return response.data;
  },

  ensureNotesConversation: async () => {
    const response = await apiClient.post('/chat/conversations/notes');
    return response.data;
  },
};

export default chatConversationsAPI;

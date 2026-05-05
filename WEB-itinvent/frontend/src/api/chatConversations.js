import apiClient from './client';

export const chatConversationsAPI = {
  getConversations: async (params = {}) => {
    const response = await apiClient.get('/chat/conversations', { params });
    return response.data;
  },

  createDirectConversation: async (peerUserId) => {
    const response = await apiClient.post('/chat/conversations/direct', {
      peer_user_id: peerUserId,
    });
    return response.data;
  },
};

export default chatConversationsAPI;

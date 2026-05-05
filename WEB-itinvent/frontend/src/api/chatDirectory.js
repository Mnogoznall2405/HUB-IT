import apiClient from './client';

export const chatDirectoryAPI = {
  getHealth: async () => {
    const response = await apiClient.get('/chat/health');
    return response.data;
  },

  getUsers: async (params = {}) => {
    const response = await apiClient.get('/chat/users', { params });
    return response.data;
  },

  listAiBots: async () => {
    const response = await apiClient.get('/chat/ai/bots');
    return response.data;
  },

  openAiBotConversation: async (botId) => {
    const response = await apiClient.post(`/chat/ai/bots/${encodeURIComponent(botId)}/open`);
    return response.data;
  },
};

export default chatDirectoryAPI;

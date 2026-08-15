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

  resolveUser: async (params = {}) => {
    const response = await apiClient.get('/chat/users/resolve', { params });
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

  createAiConversation: async () => {
    const response = await apiClient.post('/chat/ai/conversations');
    return response.data;
  },

  createAiBotConversation: async (botId) => {
    const response = await apiClient.post(`/chat/ai/bots/${encodeURIComponent(botId)}/conversations`);
    return response.data;
  },

  renameAiConversation: async (conversationId, title) => {
    const response = await apiClient.patch(
      `/chat/ai/conversations/${encodeURIComponent(conversationId)}`,
      { title },
    );
    return response.data;
  },

  deleteAiConversation: async (conversationId) => {
    const response = await apiClient.delete(`/chat/ai/conversations/${encodeURIComponent(conversationId)}`);
    return response.data;
  },

  stopAiConversationRun: async (conversationId) => {
    const response = await apiClient.post(`/chat/ai/conversations/${encodeURIComponent(conversationId)}/stop`);
    return response.data;
  },

  resetAiConversationContext: async (conversationId) => {
    const response = await apiClient.post(
      `/chat/ai/conversations/${encodeURIComponent(conversationId)}/reset-context`,
    );
    return response.data;
  },

  getAiMemory: async () => {
    const response = await apiClient.get('/chat/ai/memory');
    return response.data;
  },

  updateAiMemorySettings: async (enabled) => {
    const response = await apiClient.patch('/chat/ai/memory/settings', { enabled: Boolean(enabled) });
    return response.data;
  },

  updateAiMemoryItem: async (memoryId, content) => {
    const response = await apiClient.patch(
      `/chat/ai/memory/${encodeURIComponent(memoryId)}`,
      { content },
    );
    return response.data;
  },

  deleteAiMemoryItem: async (memoryId) => {
    const response = await apiClient.delete(`/chat/ai/memory/${encodeURIComponent(memoryId)}`);
    return response.data;
  },

  clearAiMemory: async () => {
    const response = await apiClient.delete('/chat/ai/memory');
    return response.data;
  },

  saveAttachmentToMyFiles: async (messageId, attachmentId) => {
    const response = await apiClient.post(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/save-to-my-files`,
    );
    return response.data;
  },
};

export default chatDirectoryAPI;

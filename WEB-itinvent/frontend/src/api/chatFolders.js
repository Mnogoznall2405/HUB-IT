import apiClient from './client';

export const chatFoldersAPI = {
  listFolders: async () => {
    const response = await apiClient.get('/chat/folders');
    return response.data;
  },

  createFolder: async (name) => {
    const response = await apiClient.post('/chat/folders', { name });
    return response.data;
  },

  updateFolder: async (folderId, payload = {}) => {
    const response = await apiClient.patch(`/chat/folders/${folderId}`, payload);
    return response.data;
  },

  deleteFolder: async (folderId) => {
    const response = await apiClient.delete(`/chat/folders/${folderId}`);
    return response.data;
  },

  getFolder: async (folderId) => {
    const response = await apiClient.get(`/chat/folders/${folderId}`);
    return response.data;
  },

  setFolderConversations: async (folderId, conversationIds = []) => {
    const response = await apiClient.put(`/chat/folders/${folderId}/conversations`, {
      conversation_ids: conversationIds,
    });
    return response.data;
  },

  addFolderConversation: async (folderId, conversationId) => {
    const response = await apiClient.post(`/chat/folders/${folderId}/conversations/${conversationId}`);
    return response.data;
  },

  removeFolderConversation: async (folderId, conversationId) => {
    const response = await apiClient.delete(`/chat/folders/${folderId}/conversations/${conversationId}`);
    return response.data;
  },
};

export default chatFoldersAPI;

import apiClient from './client';

export const chatAiSandboxAPI = {
  getConversation: async (conversationId) => {
    const response = await apiClient.get(
      `/chat/ai/sandbox/conversations/${encodeURIComponent(conversationId)}`,
    );
    return response.data;
  },

  respondPermission: async (permissionId, { decision, scope = 'once' }) => {
    const response = await apiClient.post(
      `/chat/ai/sandbox/permissions/${encodeURIComponent(permissionId)}/respond`,
      { decision, scope },
    );
    return response.data;
  },

  attachArchive: async (conversationId) => {
    const response = await apiClient.post(
      `/chat/ai/sandbox/conversations/${encodeURIComponent(conversationId)}/archive/attach`,
    );
    return response.data;
  },

  attachFile: async (fileId) => {
    const response = await apiClient.post(
      `/chat/ai/sandbox/files/${encodeURIComponent(fileId)}/attach`,
    );
    return response.data;
  },
};

export default chatAiSandboxAPI;

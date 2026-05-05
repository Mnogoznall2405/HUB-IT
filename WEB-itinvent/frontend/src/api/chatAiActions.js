import apiClient from './client';

export const chatAiActionsAPI = {
  getConversationAiStatus: async (conversationId) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/ai-status`);
    return response.data;
  },

  confirmAiAction: async (actionId, payload = undefined) => {
    const response = await apiClient.post(`/chat/ai/actions/${encodeURIComponent(actionId)}/confirm`, payload || {});
    return response.data;
  },

  cancelAiAction: async (actionId) => {
    const response = await apiClient.post(`/chat/ai/actions/${encodeURIComponent(actionId)}/cancel`);
    return response.data;
  },
};

export default chatAiActionsAPI;

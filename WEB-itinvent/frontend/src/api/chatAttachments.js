import apiClient from './client';

export const chatAttachmentsAPI = {
  getConversationAssetsSummary: async (conversationId) => {
    const response = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/assets-summary`);
    return response.data;
  },

  getConversationAttachments: async (conversationId, params = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/attachments`,
      { params },
    );
    return response.data;
  },

  downloadAttachment: async (messageId, attachmentId) => {
    const response = await apiClient.get(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },
};

export default chatAttachmentsAPI;

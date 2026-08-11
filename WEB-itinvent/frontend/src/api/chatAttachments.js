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

  downloadAttachment: async (messageId, attachmentId, options = {}) => {
    const signalConfig = options?.signal ? { signal: options.signal } : {};
    const response = await apiClient.get(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob', ...signalConfig },
    );
    return response;
  },

  getAttachmentPreview: async (messageId, attachmentId, options = {}) => {
    const signalConfig = options?.signal ? { signal: options.signal } : {};
    const response = await apiClient.get(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/preview`,
      signalConfig,
    );
    return response.data;
  },

  downloadAttachmentPreviewPdf: async (messageId, attachmentId, options = {}) => (
    apiClient.get(
      `/chat/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/preview/pdf`,
      {
        responseType: 'blob',
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    )
  ),
};

export default chatAttachmentsAPI;

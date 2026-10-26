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

  // The history of a conversation as a file; the server names it and says whether it was cut.
  exportConversation: async (conversationId, { format = 'txt', created_from, created_to } = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/export`,
      { params: { format, created_from, created_to }, responseType: 'blob', timeout: 120000 },
    );
    const disposition = String(response.headers?.['content-disposition'] || '');
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] || '';
    let fileName = `chat-history.${format}`;
    if (encoded) {
      try { fileName = decodeURIComponent(encoded); } catch { /* keep the default name */ }
    }
    return {
      blob: response.data,
      fileName,
      truncated: String(response.headers?.['x-chat-export-truncated'] || '') === '1',
    };
  },

  reportMessage: async (conversationId, messageId, { reason, comment } = {}) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/report`,
      { reason, comment: String(comment || '').trim() || undefined },
    );
    return response.data;
  },

  listJoinRequests: async (conversationId) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/join-requests`,
    );
    return response.data;
  },

  setJoinApproval: async (conversationId, approvalRequired) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/join-approval`,
      { approval_required: Boolean(approvalRequired) },
    );
    return response.data;
  },

  resolveJoinRequest: async (conversationId, requestId, decision) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/join-requests/${encodeURIComponent(requestId)}`,
      { decision },
    );
    return response.data;
  },

  listMessageReports: async (conversationId) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/reports`,
    );
    return response.data;
  },

  resolveMessageReport: async (conversationId, reportId, resolution) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/reports/${encodeURIComponent(reportId)}`,
      { resolution },
    );
    return response.data;
  },

  getPinnedMessages: async (conversationId) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/pinned-messages`,
    );
    return response.data;
  },

  pinMessage: async (conversationId, messageId) => {
    const response = await apiClient.put(
      `/chat/conversations/${encodeURIComponent(conversationId)}/pinned-messages/${encodeURIComponent(messageId)}`,
    );
    return response.data;
  },

  unpinMessage: async (conversationId, messageId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/pinned-messages/${encodeURIComponent(messageId)}`,
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

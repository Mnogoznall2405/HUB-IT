import apiClient from './client';

export const chatMessageSendingAPI = {
  getShareableTasks: async (conversationId, params = {}) => {
    const response = await apiClient.get(
      `/chat/conversations/${encodeURIComponent(conversationId)}/shareable-tasks`,
      { params },
    );
    return response.data;
  },

  sendMessage: async (conversationId, body, options = {}) => {
    const response = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      body,
      body_format: options?.body_format || undefined,
      client_message_id: options?.client_message_id || undefined,
      reply_to_message_id: options?.reply_to_message_id || undefined,
    });
    return response.data;
  },

  forwardMessage: async (conversationId, sourceMessageId, options = {}) => {
    const payload = {
      source_message_id: sourceMessageId,
    };
    const body = String(options?.body || '').trim();
    if (body) payload.body = body;
    if (options?.body_format) payload.body_format = options.body_format;
    if (options?.reply_to_message_id) payload.reply_to_message_id = options.reply_to_message_id;
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/forward`,
      payload,
    );
    return response.data;
  },

  shareTask: async (conversationId, taskId, options = {}) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/task-share`,
      {
        task_id: taskId,
        reply_to_message_id: options?.reply_to_message_id || undefined,
      },
    );
    return response.data;
  },

  sendReaction: async (conversationId, messageId, reactionEmoji) => {
    const response = await apiClient.post(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reaction`,
      {
        reaction_emoji: reactionEmoji || undefined,
      },
    );
    return response.data;
  },

  removeReaction: async (conversationId, messageId) => {
    const response = await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    );
    return response.data;
  },
};

export default chatMessageSendingAPI;

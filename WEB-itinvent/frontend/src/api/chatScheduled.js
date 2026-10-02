import apiClient from './client';

// "Send later": text messages delivered by the server at the chosen time.
// Needs CHAT_SCHEDULED_MESSAGES_ENABLED (GET /chat/config -> scheduled_messages_enabled).
export const chatScheduledAPI = {
  async list(conversationId) {
    const { data } = await apiClient.get(`/chat/conversations/${encodeURIComponent(conversationId)}/scheduled`);
    return Array.isArray(data?.items) ? data.items : [];
  },
  async create(conversationId, { body, scheduledFor, replyToMessageId = null, bodyFormat = 'plain' }) {
    const { data } = await apiClient.post(`/chat/conversations/${encodeURIComponent(conversationId)}/scheduled`, {
      body,
      body_format: bodyFormat,
      scheduled_for: scheduledFor,
      reply_to_message_id: replyToMessageId || undefined,
    });
    return data;
  },
  async update(scheduledId, { body, scheduledFor }) {
    const payload = {};
    if (body !== undefined) payload.body = body;
    if (scheduledFor !== undefined) payload.scheduled_for = scheduledFor;
    const { data } = await apiClient.patch(`/chat/scheduled/${encodeURIComponent(scheduledId)}`, payload);
    return data;
  },
  async cancel(scheduledId) {
    const { data } = await apiClient.delete(`/chat/scheduled/${encodeURIComponent(scheduledId)}`);
    return data;
  },
};

export default chatScheduledAPI;

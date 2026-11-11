import apiClient from './client';

export const aiBotAccess = {
  async users(botId, params = {}) {
    return (await apiClient.get(`/ai-bots/${encodeURIComponent(botId)}/access`, { params })).data;
  },
  async agents(userId) {
    return (await apiClient.get(`/ai-bots/access/users/${encodeURIComponent(userId)}`)).data;
  },
  async set(botId, userId, allowed) {
    const result = (await apiClient.put(`/ai-bots/${encodeURIComponent(botId)}/access/${encodeURIComponent(userId)}`, { allowed })).data;
    window.dispatchEvent(new Event('ai-agent-access-changed'));
    return result;
  },
  async conversation(conversationId) {
    return (await apiClient.get(`/chat/ai/conversations/${encodeURIComponent(conversationId)}/access`)).data;
  },
};

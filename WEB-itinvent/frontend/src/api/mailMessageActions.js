import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

export const mailMessageActionsAPI = {
  markAsRead: async (messageId, mailboxId = '') => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/read`,
      null,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  markAsUnread: async (messageId, mailboxId = '') => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/unread`,
      null,
      { params: withMailboxQuery({}, mailboxId) },
    );
    return response.data;
  },

  moveMessage: async (messageId, payload) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/move`, payload);
    return response.data;
  },

  deleteMessage: async (messageId, payload = {}) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/delete`, payload);
    return response.data;
  },

  restoreMessage: async (messageId, payload = {}) => {
    const response = await apiClient.post(`/mail/messages/${encodeURIComponent(messageId)}/restore`, payload);
    return response.data;
  },

  bulkMessageAction: async (payload) => {
    const response = await apiClient.post('/mail/messages/bulk', payload);
    return response.data;
  },

  markAllRead: async (payload = {}) => {
    const response = await apiClient.post('/mail/messages/mark-all-read', payload);
    return response.data;
  },

  setImportance: async (messageId, payload = {}) => {
    const response = await apiClient.post(
      `/mail/messages/${encodeURIComponent(messageId)}/importance`,
      payload,
    );
    return response.data;
  },
};

export default mailMessageActionsAPI;

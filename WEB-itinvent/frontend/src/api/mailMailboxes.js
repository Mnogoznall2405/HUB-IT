import apiClient from './client';

export const mailMailboxesAPI = {
  listMailboxes: async (options = {}) => {
    const params = {};
    if (typeof options?.includeUnread === 'boolean') {
      params.include_unread = options.includeUnread;
    }
    const response = await apiClient.get('/mail/mailboxes', { params });
    return response.data;
  },

  createMailbox: async (payload) => {
    const response = await apiClient.post('/mail/mailboxes', payload);
    return response.data;
  },

  updateMailbox: async (mailboxId, payload) => {
    const response = await apiClient.patch(`/mail/mailboxes/${encodeURIComponent(mailboxId)}`, payload);
    return response.data;
  },

  deleteMailbox: async (mailboxId) => {
    const response = await apiClient.delete(`/mail/mailboxes/${encodeURIComponent(mailboxId)}`);
    return response.data;
  },
};

export default mailMailboxesAPI;

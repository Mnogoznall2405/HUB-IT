import apiClient from './client';

export const mailMailboxQuotasAPI = {
  getLatestSnapshot: async () => {
    const response = await apiClient.get('/mail/mailbox-quota-snapshots/latest');
    return response.data;
  },

  listSnapshots: async (limit = 20) => {
    const response = await apiClient.get('/mail/mailbox-quota-snapshots', {
      params: { limit },
    });
    return response.data || [];
  },

  getSnapshotSummary: async (snapshotId) => {
    const response = await apiClient.get(`/mail/mailbox-quota-snapshots/${snapshotId}/summary`);
    return response.data;
  },

  listRows: async (snapshotId, params = {}) => {
    const response = await apiClient.get(`/mail/mailbox-quota-snapshots/${snapshotId}/rows`, {
      params,
    });
    return response.data;
  },
};

import apiClient from './client';

export const chatNotificationsAPI = {
  getUnreadSummary: async () => {
    const response = await apiClient.get('/chat/unread-summary');
    return response.data;
  },

  getPushConfig: async () => {
    const response = await apiClient.get('/chat/push-config');
    return response.data;
  },

  upsertPushSubscription: async (payload) => {
    const response = await apiClient.put('/chat/push-subscription', payload);
    return response.data;
  },

  deletePushSubscription: async (endpoint) => {
    const response = await apiClient.delete('/chat/push-subscription', {
      data: { endpoint },
    });
    return response.data;
  },
};

export default chatNotificationsAPI;

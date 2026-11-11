import apiClient from './client';

export const hubNotificationsAPI = {
  pollNotifications: async (params = {}) => {
    const response = await apiClient.get('/hub/notifications/poll', { params });
    return response.data;
  },

  getUnreadCounts: async () => {
    const response = await apiClient.get('/hub/notifications/unread-counts');
    return response.data;
  },

  markNotificationRead: async (notificationId) => {
    const response = await apiClient.post(`/hub/notifications/${encodeURIComponent(notificationId)}/read`);
    return response.data;
  },

  markAllNotificationsRead: async () => {
    const response = await apiClient.post('/hub/notifications/read-all');
    return response.data;
  },
};

export default hubNotificationsAPI;

import apiClient from './client';

export const hubTaskAnalyticsAPI = {
  getTaskAnalytics: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks/analytics', { params });
    return response.data;
  },

  exportTaskAnalyticsExcel: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks/analytics/export', {
      params,
      responseType: 'blob',
    });
    return response;
  },
};

export default hubTaskAnalyticsAPI;

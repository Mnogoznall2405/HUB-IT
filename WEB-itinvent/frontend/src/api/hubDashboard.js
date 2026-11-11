import apiClient from './client';

export const hubDashboardAPI = {
  getDashboard: async (params = {}) => {
    const response = await apiClient.get('/hub/dashboard', { params });
    return response.data;
  },
};

export default hubDashboardAPI;

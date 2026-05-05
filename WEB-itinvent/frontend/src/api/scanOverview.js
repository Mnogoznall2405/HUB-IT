import apiClient from './client';

export const scanOverviewAPI = {
  getDashboard: async () => {
    const response = await apiClient.get('/scan/dashboard');
    return response.data;
  },

  getBranches: async () => {
    const response = await apiClient.get('/scan/branches');
    return response.data;
  },

  getHostsTable: async (params = {}) => {
    const response = await apiClient.get('/scan/hosts/table', { params });
    return response.data;
  },
};

export default scanOverviewAPI;

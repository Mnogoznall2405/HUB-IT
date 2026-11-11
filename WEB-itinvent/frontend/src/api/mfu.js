import apiClient from './client';

export const mfuAPI = {
  getDevices: async (params = {}) => {
    const response = await apiClient.get('/mfu/devices', { params });
    return response.data;
  },

  getMonthlyPages: async (params = {}) => {
    const response = await apiClient.get('/mfu/pages/monthly', { params });
    return response.data;
  },
};

export default mfuAPI;

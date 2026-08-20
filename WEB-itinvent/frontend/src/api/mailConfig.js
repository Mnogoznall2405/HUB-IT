import apiClient from './client';
import { withMailboxQuery } from './mailMailboxQuery';

export const mailConfigAPI = {
  getMyConfig: async (params = {}) => {
    const response = await apiClient.get('/mail/config/me', { params: withMailboxQuery(params) });
    return response.data;
  },

  updateMyConfig: async (payload) => {
    const response = await apiClient.patch('/mail/config/me', payload);
    return response.data;
  },

  saveMyCredentials: async (payload) => {
    const response = await apiClient.post('/mail/config/me/credentials', payload);
    return response.data;
  },

  updateUserConfig: async (userId, payload) => {
    const response = await apiClient.patch(`/mail/config/user/${userId}`, payload);
    return response.data;
  },

  testConnection: async (payload = {}) => {
    const response = await apiClient.post('/mail/test-connection', payload);
    return response.data;
  },
};

export default mailConfigAPI;

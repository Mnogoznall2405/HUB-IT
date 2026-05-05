import apiClient from './client';

export const authAccountSecurityAPI = {
  getCurrentUser: async (options = {}) => {
    const response = await apiClient.get('/auth/me', {
      suppressAuthRequired: Boolean(options?.suppressAuthRequired),
    });
    return response.data;
  },

  logout: async () => {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },

  regenerateBackupCodes: async () => {
    const response = await apiClient.post('/auth/backup-codes/regenerate');
    return response.data;
  },

  resetOwnTwoFactor: async () => {
    const response = await apiClient.post('/auth/reset-2fa-self');
    return response.data;
  },
};

export default authAccountSecurityAPI;

import apiClient from './http';

export const authAccountSecurityAPI = {
  getCurrentUser: async (options = {}) => {
    const response = await apiClient.get('/auth/me', {
      suppressAuthRequired: Boolean(options?.suppressAuthRequired),
    });
    return response.data;
  },

  completeAboutOnboarding: async () => {
    const response = await apiClient.post('/auth/me/about-onboarding/complete');
    return response.data;
  },

  logout: async () => {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },

  regenerateBackupCodes: async (payload) => {
    const response = await apiClient.post('/auth/backup-codes/regenerate', payload);
    return response.data;
  },

  resetOwnTwoFactor: async (payload) => {
    const response = await apiClient.post('/auth/reset-2fa-self', payload);
    return response.data;
  },
};

export default authAccountSecurityAPI;

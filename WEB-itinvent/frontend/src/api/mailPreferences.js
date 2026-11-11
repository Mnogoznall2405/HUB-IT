import apiClient from './client';

export const mailPreferencesAPI = {
  getPreferences: async () => {
    const response = await apiClient.get('/mail/preferences');
    return response.data;
  },

  updatePreferences: async (payload) => {
    const response = await apiClient.patch('/mail/preferences', payload);
    return response.data;
  },
};

export default mailPreferencesAPI;

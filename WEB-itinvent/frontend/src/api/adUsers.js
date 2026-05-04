import apiClient from './client';

export const adUsersAPI = {
  getPasswordStatus: async () => {
    const { data } = await apiClient.get('/ad-users/password-status');
    return data;
  },
  getImportCandidates: async () => {
    const { data } = await apiClient.get('/ad-users/import-candidates');
    return data;
  },
  importToApp: async (login) => {
    const { data } = await apiClient.post('/ad-users/import-to-app', { login });
    return data;
  },
  syncToApp: async (logins = []) => {
    const { data } = await apiClient.post('/ad-users/sync-to-app', {
      logins: Array.isArray(logins) ? logins : [],
    });
    return data;
  },
  assignBranch: async (payload) => {
    const { data } = await apiClient.post('/ad-users/assign-branch', payload);
    return data;
  },
};

export default adUsersAPI;

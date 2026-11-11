import apiClient from './client';

export const adUsersAPI = {
  getPasswordStatus: async () => {
    const { data } = await apiClient.get('/ad-users/password-status');
    return data;
  },
  getOrganizationalUnits: async (parentDn = '', { force = false } = {}) => {
    const { data } = await apiClient.get('/ad-users/organizational-units', {
      params: {
        ...(parentDn ? { parent_dn: parentDn } : {}),
        ...(force ? { force: true } : {}),
      },
    });
    return data;
  },
  getPasswordExpiry: async ({ ouDn = '', mode = 'all', daysThreshold = 7, q = '', force = false } = {}) => {
    const { data } = await apiClient.get('/ad-users/password-expiry', {
      params: {
        ...(ouDn ? { ou_dn: ouDn } : {}),
        mode,
        days_threshold: daysThreshold,
        ...(q ? { q } : {}),
        ...(force ? { force: true } : {}),
      },
    });
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
  syncAllToApp: async () => {
    const { data } = await apiClient.post('/ad-users/sync-all-to-app');
    return data;
  },
  getSyncStatus: async () => {
    const { data } = await apiClient.get('/ad-users/sync-status');
    return data;
  },
  assignBranch: async (payload) => {
    const { data } = await apiClient.post('/ad-users/assign-branch', payload);
    return data;
  },
};

export default adUsersAPI;

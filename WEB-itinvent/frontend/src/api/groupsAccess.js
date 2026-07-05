import apiClient from './client';

export const groupsAccessAPI = {
  getStatus: async () => {
    const { data } = await apiClient.get('/groups-access/status');
    return data;
  },

  getMatrix: async ({ branch = '', q = '', page = 1, limit = 50 } = {}) => {
    const { data } = await apiClient.get('/groups-access/matrix', {
      params: {
        branch: branch || undefined,
        q: q || undefined,
        page,
        limit,
      },
    });
    return data;
  },

  searchUser: async ({ q, branch = '', limit = 100 } = {}) => {
    const { data } = await apiClient.get('/groups-access/user', {
      params: {
        q,
        branch: branch || undefined,
        limit,
      },
    });
    return data;
  },

  getGroup: async (dn) => {
    const { data } = await apiClient.get('/groups-access/group', {
      params: { dn },
    });
    return data;
  },

  getMatrixGrid: async ({
    branch = '',
    folderQ = '',
    userQ = '',
    groupLimit,
    userLimit,
  } = {}) => {
    const { data } = await apiClient.get('/groups-access/matrix-grid', {
      params: {
        branch: branch || undefined,
        folder_q: folderQ || undefined,
        user_q: userQ || undefined,
        group_limit: groupLimit || undefined,
        user_limit: userLimit || undefined,
      },
    });
    return data;
  },

  getExport: async ({ branch = '', folderQ = '', userQ = '' } = {}) => {
    const { data } = await apiClient.get('/groups-access/export', {
      params: {
        branch: branch || undefined,
        folder_q: folderQ || undefined,
        user_q: userQ || undefined,
      },
    });
    return data;
  },

  refresh: async () => {
    const { data } = await apiClient.post('/groups-access/refresh');
    return data;
  },
};

export default groupsAccessAPI;

import apiClient from './client';

const encodeId = (value) => encodeURIComponent(String(value || '').trim());

export const passwordsAPI = {
  getEntries: async (params = {}) => {
    const response = await apiClient.get('/passwords', { params });
    return response.data;
  },

  createEntry: async (payload) => {
    const response = await apiClient.post('/passwords', payload);
    return response.data;
  },

  getGroups: async (params = {}) => {
    const response = await apiClient.get('/passwords/groups', { params });
    return response.data;
  },

  createGroup: async (payload) => {
    const response = await apiClient.post('/passwords/groups', payload);
    return response.data;
  },

  updateGroup: async (id, payload) => {
    const response = await apiClient.patch(`/passwords/groups/${encodeId(id)}`, payload);
    return response.data;
  },

  archiveGroup: async (id) => {
    const response = await apiClient.post(`/passwords/groups/${encodeId(id)}/archive`);
    return response.data;
  },

  updateEntry: async (id, payload) => {
    const response = await apiClient.patch(`/passwords/${encodeId(id)}`, payload);
    return response.data;
  },

  archiveEntry: async (id) => {
    const response = await apiClient.post(`/passwords/${encodeId(id)}/archive`);
    return response.data;
  },

  unlock: async (payload) => {
    const response = await apiClient.post('/passwords/unlock', payload);
    return response.data;
  },

  revealEntry: async (id, payload) => {
    const response = await apiClient.post(`/passwords/${encodeId(id)}/reveal`, payload);
    return response.data;
  },

  getAudit: async (params = {}) => {
    const response = await apiClient.get('/passwords/audit', { params });
    return response.data;
  },
};

export default passwordsAPI;

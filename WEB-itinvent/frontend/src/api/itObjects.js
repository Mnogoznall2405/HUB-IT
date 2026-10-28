import apiClient from './client';


const refPath = (objectRef) => encodeURIComponent(String(objectRef || '').trim());

export const itObjectsAPI = {
  list: async ({ search = '', mine = false, signal } = {}) => {
    const { data } = await apiClient.get('/it-objects', { params: { q: search, mine }, signal });
    return data;
  },
  get: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}`, { signal });
    return data;
  },
  computers: async (objectRef, { signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/computers`, { signal });
    return data;
  },
  inventory: async (objectRef, { page = 1, limit = 100, signal } = {}) => {
    const { data } = await apiClient.get(`/it-objects/${refPath(objectRef)}/inventory`, { params: { page, limit }, signal });
    return data;
  },
  userOptions: async (query = '', { signal } = {}) => {
    const { data } = await apiClient.get('/it-objects/user-options', { params: { q: query }, signal });
    return data;
  },
  assignOwner: async (objectRef, userId) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/owner`, { user_id: userId });
    return data;
  },
  clearOwner: async (objectRef) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/owner`);
    return data;
  },
  grant: async (objectRef, { userId, section, level }) => {
    const { data } = await apiClient.put(`/it-objects/${refPath(objectRef)}/grants`, {
      user_id: userId,
      section,
      level,
    });
    return data;
  },
  revoke: async (objectRef, { userId, section }) => {
    const { data } = await apiClient.delete(`/it-objects/${refPath(objectRef)}/grants`, {
      params: { user_id: userId, section },
    });
    return data;
  },
};

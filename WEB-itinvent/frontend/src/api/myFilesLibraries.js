import apiClient from './client';

const libraryUrl = (libraryId, suffix = '') => `/my-files/libraries/${encodeURIComponent(libraryId)}${suffix}`;

export const myFilesLibrariesAPI = {
  list: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/libraries', { signal });
    return response.data;
  },
  create: async ({ name, quotaBytes = 0 } = {}) => {
    const response = await apiClient.post('/my-files/libraries', {
      name: String(name || '').trim(),
      quota_bytes: Math.max(0, Math.round(Number(quotaBytes) || 0)),
    });
    return response.data;
  },
  update: async (libraryId, { name, quotaBytes } = {}) => {
    const payload = {};
    if (name !== undefined) payload.name = String(name || '').trim();
    if (quotaBytes !== undefined) payload.quota_bytes = Math.max(0, Math.round(Number(quotaBytes) || 0));
    const response = await apiClient.patch(libraryUrl(libraryId), payload);
    return response.data;
  },
  remove: async (libraryId) => {
    await apiClient.delete(libraryUrl(libraryId));
  },
  listMembers: async (libraryId, { signal } = {}) => {
    const response = await apiClient.get(libraryUrl(libraryId, '/members'), { signal });
    return response.data;
  },
  setMembers: async (libraryId, members) => {
    const response = await apiClient.put(libraryUrl(libraryId, '/members'), {
      members: (members || []).map((item) => ({
        principal_type: String(item.principal_type),
        principal_id: String(item.principal_id),
        role: String(item.role || 'edit'),
      })),
    });
    return response.data;
  },
};

export default myFilesLibrariesAPI;

import apiClient from './client';

export const myFilesAdminAPI = {
  listFiles: async ({ q = '', ownerUserId = null, scope = 'all', state = 'active', limit = 50, offset = 0, signal } = {}) => {
    const response = await apiClient.get('/my-files/admin/files', {
      params: { q: q || undefined, owner_user_id: ownerUserId || undefined, scope, state, limit, offset }, signal,
    });
    return response.data;
  },
  getFile: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(`/my-files/admin/files/${encodeURIComponent(fileId)}`, { signal });
    return response.data;
  },
};

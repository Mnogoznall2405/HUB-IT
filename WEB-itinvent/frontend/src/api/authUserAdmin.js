import apiClient from './client';

const TASK_DELEGATE_BULK_CHUNK_SIZE = 80;

export const authUserAdminAPI = {
  getUsers: async () => {
    const response = await apiClient.get('/auth/users');
    return response.data;
  },

  createUser: async (payload) => {
    const response = await apiClient.post('/auth/users', payload);
    return response.data;
  },

  updateUser: async (userId, payload) => {
    const response = await apiClient.patch(`/auth/users/${userId}`, payload);
    return response.data;
  },

  getTaskDelegates: async (userId) => {
    const response = await apiClient.get(`/auth/users/${userId}/task-delegates`);
    return response.data;
  },

  getTaskDelegatesBulk: async (ownerIds = []) => {
    const normalizedOwnerIds = (Array.isArray(ownerIds) ? ownerIds : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0);
    if (normalizedOwnerIds.length === 0) {
      return { items: [] };
    }
    const mergedItems = [];
    for (let offset = 0; offset < normalizedOwnerIds.length; offset += TASK_DELEGATE_BULK_CHUNK_SIZE) {
      const chunk = normalizedOwnerIds.slice(offset, offset + TASK_DELEGATE_BULK_CHUNK_SIZE);
      const response = await apiClient.get('/auth/task-delegates', {
        params: { owner_ids: chunk.join(',') },
      });
      const chunkItems = response.data?.items;
      if (Array.isArray(chunkItems)) {
        mergedItems.push(...chunkItems);
      }
    }
    return { items: mergedItems };
  },

  updateTaskDelegates: async (userId, items = []) => {
    const response = await apiClient.put(`/auth/users/${userId}/task-delegates`, {
      items: Array.isArray(items) ? items : [],
    });
    return response.data;
  },

  deleteUser: async (userId) => {
    const response = await apiClient.delete(`/auth/users/${userId}`);
    return response.data;
  },
};

export default authUserAdminAPI;

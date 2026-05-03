import apiClient from './client';

export const departmentsAPI = {
  list: async (params = {}) => {
    const response = await apiClient.get('/departments', { params });
    return response.data;
  },

  getMembers: async (departmentId) => {
    const response = await apiClient.get(`/departments/${encodeURIComponent(departmentId)}/members`);
    return response.data;
  },

  setManagers: async (departmentId, managerUserIds = []) => {
    const response = await apiClient.put(`/departments/${encodeURIComponent(departmentId)}/managers`, {
      manager_user_ids: Array.isArray(managerUserIds) ? managerUserIds : [],
    });
    return response.data;
  },

  syncFromUsers: async () => {
    const response = await apiClient.post('/departments/sync-from-users');
    return response.data;
  },

  syncFromAD: async () => {
    const response = await apiClient.post('/departments/sync-from-ad');
    return response.data;
  },
};

export default departmentsAPI;

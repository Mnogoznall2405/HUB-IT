import apiClient from './client';

export const equipmentRecordsAPI = {
  getByInvNo: async (invNo) => {
    const response = await apiClient.get(`/equipment/${encodeURIComponent(String(invNo ?? ''))}`);
    return response.data;
  },

  getEquipmentHistory: async (invNo) => {
    const response = await apiClient.get(`/equipment/${encodeURIComponent(String(invNo ?? ''))}/history`);
    return response.data;
  },

  getAllEquipment: async (page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/database', {
      params: { page, limit },
    });
    return response.data;
  },

  getAllEquipmentGrouped: async ({ page = 1, limit = 1000, branch } = {}) => {
    const response = await apiClient.get('/equipment/all-grouped', {
      params: { page, limit, branch: branch || undefined },
    });
    return response.data;
  },

  getByInvNos: async (invNos = []) => {
    const response = await apiClient.post('/equipment/by-inv-nos', {
      inv_nos: Array.isArray(invNos) ? invNos : [],
    });
    return response.data;
  },

  updateByInvNo: async (invNo, payload) => {
    const response = await apiClient.patch(`/equipment/${invNo}`, payload);
    return response.data;
  },

  deleteByInvNo: async (invNo) => {
    const response = await apiClient.delete(`/equipment/${invNo}`);
    return response.data;
  },

  createEquipment: async (payload) => {
    const response = await apiClient.post('/equipment/create', payload);
    return response.data;
  },
};

export default equipmentRecordsAPI;

import apiClient from './client';

export const equipmentSearchAPI = {
  searchBySerial: async (query) => {
    const response = await apiClient.get('/equipment/search/serial', {
      params: { q: query },
    });
    return response.data;
  },

  searchUniversal: async (query, page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/search/universal', {
      params: { q: query, page, limit },
    });
    return response.data;
  },

  searchByEmployee: async (query, page = 1, limit = 50) => {
    const response = await apiClient.get('/equipment/search/employee', {
      params: { q: query, page, limit },
    });
    return response.data;
  },

  getEmployeeEquipment: async (ownerNo) => {
    const response = await apiClient.get(`/equipment/employee/${ownerNo}/items`);
    return response.data;
  },
};

export default equipmentSearchAPI;

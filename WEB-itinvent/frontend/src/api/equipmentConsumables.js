import apiClient from './client';

export const equipmentConsumablesAPI = {
  getAllConsumablesGrouped: async ({ page = 1, limit = 1000 } = {}) => {
    const response = await apiClient.get('/equipment/consumables-grouped', {
      params: { page, limit },
    });
    return response.data;
  },

  createConsumable: async (payload) => {
    const response = await apiClient.post('/equipment/consumables/create', payload);
    return response.data;
  },

  lookupConsumables: async (params = {}) => {
    const response = await apiClient.get('/equipment/consumables/lookup', { params });
    return response.data;
  },

  consumeConsumable: async (payload) => {
    const response = await apiClient.post('/equipment/consumables/consume', payload);
    return response.data;
  },

  updateConsumableQty: async (payload) => {
    const response = await apiClient.patch('/equipment/consumables/qty', payload);
    return response.data;
  },
};

export default equipmentConsumablesAPI;

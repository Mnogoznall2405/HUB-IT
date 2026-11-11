import apiClient from './client';

export const employeeHistoryAPI = {
  getHistory: async (ownerNo, { signal, dbId, ...params } = {}) => {
    const response = await apiClient.get(`/equipment/employee/${ownerNo}/history`, {
      params,
      signal,
      ...(dbId ? { headers: { 'X-Database-ID': dbId } } : {}),
    });
    return response.data;
  },
};

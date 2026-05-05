import apiClient from './client';

export const scanTasksAPI = {
  getPatterns: async () => {
    const response = await apiClient.get('/scan/patterns');
    return response.data;
  },

  getTasks: async (params = {}) => {
    const response = await apiClient.get('/scan/tasks', { params });
    return response.data;
  },

  createTask: async (payload) => {
    const response = await apiClient.post('/scan/tasks', payload);
    return response.data;
  },
};

export default scanTasksAPI;

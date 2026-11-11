import apiClient from './client';

export const scanTasksAPI = {
  getPatterns: async () => {
    const response = await apiClient.get('/scan/patterns');
    return response.data;
  },

  getTasks: async (params = {}) => {
    // UI list uses light projection; callers can override with view:'detail'.
    const response = await apiClient.get('/scan/tasks', { params: { view: 'summary', ...params } });
    return response.data;
  },

  getTaskSystemMetrics: async (taskId, params = {}, options = {}) => {
    const response = await apiClient.get(`/scan/tasks/${encodeURIComponent(taskId)}/system-metrics`, {
      params: {
        max_points: 500,
        view: 'chart',
        from_ts: Math.floor(Date.now() / 1000) - 6 * 3600,
        ...params,
      },
      signal: options?.signal,
    });
    return response.data;
  },

  createTask: async (payload) => {
    const response = await apiClient.post('/scan/tasks', payload);
    return response.data;
  },
};

export default scanTasksAPI;

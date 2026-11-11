import apiClient from './client';

export const hubTaskCanvasAPI = {
  getTaskCanvas: async (taskId, options = {}) => {
    const response = await apiClient.get(
      `/hub/tasks/${encodeURIComponent(taskId)}/canvas`,
      options.signal ? { signal: options.signal } : undefined,
    );
    return response.data;
  },

  saveTaskCanvas: async (taskId, payload) => {
    const response = await apiClient.put(
      `/hub/tasks/${encodeURIComponent(taskId)}/canvas`,
      payload,
    );
    return response.data;
  },
};

export default hubTaskCanvasAPI;

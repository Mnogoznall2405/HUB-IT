import apiClient from './client';

export const hubTasksAPI = {
  getTasks: async (params = {}) => {
    const response = await apiClient.get('/hub/tasks', { params });
    return response.data;
  },

  getTask: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}`);
    return response.data;
  },

  /**
   * @param {object} payload
   * @param {number[]} [payload.observer_user_ids]
   */
  createTask: async (payload) => {
    const response = await apiClient.post('/hub/tasks', payload);
    return response.data;
  },

  /**
   * @param {object} payload
   * @param {number[]} [payload.observer_user_ids]
   */
  updateTask: async (taskId, payload) => {
    const response = await apiClient.patch(`/hub/tasks/${encodeURIComponent(taskId)}`, payload);
    return response.data;
  },

  deleteTask: async (taskId) => {
    const response = await apiClient.delete(`/hub/tasks/${encodeURIComponent(taskId)}`);
    return response.data;
  },

  startTask: async (taskId) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/start`);
    return response.data;
  },

  submitTask: async ({ taskId, comment = '', file = null }) => {
    const formData = new FormData();
    formData.append('comment', String(comment || ''));
    if (file) {
      formData.append('file', file);
    }
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/submit`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  reviewTask: async (taskId, payload) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/review`, payload);
    return response.data;
  },

  reopenTask: async (taskId, payload = {}) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/reopen`, payload);
    return response.data;
  },
};

export default hubTasksAPI;

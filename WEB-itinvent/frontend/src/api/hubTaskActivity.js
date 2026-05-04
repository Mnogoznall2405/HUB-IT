import apiClient from './client';

export const hubTaskActivityAPI = {
  getTaskComments: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}/comments`);
    return response.data;
  },

  addTaskComment: async (taskId, body) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/comments`, { body });
    return response.data;
  },

  markTaskCommentsSeen: async (taskId) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/comments/mark-seen`);
    return response.data;
  },

  getTaskStatusLog: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}/status-log`);
    return response.data;
  },
};

export default hubTaskActivityAPI;

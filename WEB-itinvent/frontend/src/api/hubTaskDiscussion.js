import apiClient from './client';

export const hubTaskDiscussionAPI = {
  getTaskDiscussion: async (taskId) => {
    const response = await apiClient.get(`/hub/tasks/${encodeURIComponent(taskId)}/discussion`);
    return response.data;
  },

  openTaskDiscussion: async (taskId) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/discussion`);
    return response.data;
  },
};

export default hubTaskDiscussionAPI;

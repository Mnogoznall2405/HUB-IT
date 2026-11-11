import apiClient from './client';

export const hubTaskSupportAPI = {
  getAssignees: async (params = {}) => {
    const response = await apiClient.get('/hub/users/assignees', { params });
    return response.data;
  },

  getControllers: async (params = {}) => {
    const response = await apiClient.get('/hub/users/controllers', { params });
    return response.data;
  },

  getTaskProjects: async (params = {}) => {
    const response = await apiClient.get('/hub/task-projects', { params });
    return response.data;
  },

  createTaskProject: async (payload) => {
    const response = await apiClient.post('/hub/task-projects', payload);
    return response.data;
  },

  updateTaskProject: async (projectId, payload) => {
    const response = await apiClient.patch(`/hub/task-projects/${encodeURIComponent(projectId)}`, payload);
    return response.data;
  },

  getTaskObjects: async (params = {}) => {
    const response = await apiClient.get('/hub/task-objects', { params });
    return response.data;
  },

  createTaskObject: async (payload) => {
    const response = await apiClient.post('/hub/task-objects', payload);
    return response.data;
  },

  updateTaskObject: async (objectId, payload) => {
    const response = await apiClient.patch(`/hub/task-objects/${encodeURIComponent(objectId)}`, payload);
    return response.data;
  },
};

export default hubTaskSupportAPI;

import apiClient from './client';

export const hubTaskSubtasksAPI = {
  /**
   * Создаёт подзадачу участником родительской задачи (POST /hub/tasks/{id}/subtasks).
   * Ответ — одна задача (подзадача), а не {items, created}.
   * @param {string} parentTaskId
   * @param {object} payload
   * @param {string} payload.title
   * @param {number[]} payload.assignee_user_ids
   */
  createSubtask: async (parentTaskId, payload) => {
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(parentTaskId)}/subtasks`, payload);
    return response.data;
  },

  getSubtasks: async (parentTaskId, params = {}) => {
    const response = await apiClient.get('/hub/tasks', {
      params: { ...params, parent_task_id: parentTaskId },
    });
    return response.data;
  },
};

export default hubTaskSubtasksAPI;

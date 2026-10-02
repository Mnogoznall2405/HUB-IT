import apiClient from './client';

const projectPath = (id) => `/voice/labeling/projects/${encodeURIComponent(id)}`;

export const voiceLabelingAPI = {
  listProjects: async (params = {}, options = {}) => {
    const response = await apiClient.get('/voice/labeling/projects', { params, signal: options?.signal });
    return response.data;
  },

  getProject: async (id, options = {}) => {
    const response = await apiClient.get(projectPath(id), { signal: options?.signal });
    return response.data;
  },

  createProject: async (file, { title = '', settings = {} } = {}, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('settings_json', JSON.stringify(settings || {}));
    const response = await apiClient.post('/voice/labeling/projects', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 10 * 60 * 1000,
      onUploadProgress: onProgress,
    });
    return response.data;
  },

  saveProject: async (id, payload) => {
    const response = await apiClient.put(projectPath(id), payload);
    return response.data;
  },

  retryProject: async (id) => {
    const response = await apiClient.post(`${projectPath(id)}/retry`);
    return response.data;
  },

  deleteProject: async (id) => {
    const response = await apiClient.delete(projectPath(id));
    return response.data;
  },

  getPeaks: async (id, options = {}) => {
    const response = await apiClient.get(`${projectPath(id)}/peaks`, { signal: options?.signal });
    return response.data;
  },

  getMetrics: async (id, params = {}) => {
    const response = await apiClient.get(`${projectPath(id)}/metrics`, { params });
    return response.data;
  },

  createVariant: async (id, separator, exclusive = false) => {
    const response = await apiClient.post(`${projectPath(id)}/variants`, { separator, exclusive });
    return response.data;
  },

  deleteVariant: async (id, name) => {
    const response = await apiClient.delete(`${projectPath(id)}/variants/${encodeURIComponent(name)}`);
    return response.data;
  },

  enrollVoices: async (id, { labels = [], replace = false } = {}) => {
    const response = await apiClient.post(`${projectPath(id)}/enroll`, { labels, replace });
    return response.data;
  },

  calibrate: async (id) => {
    const response = await apiClient.post(`${projectPath(id)}/calibrate`);
    return response.data;
  },

  getCalibration: async (id) => {
    const response = await apiClient.get(`${projectPath(id)}/calibration`);
    return response.data;
  },

  getOverallCalibration: async () => {
    const response = await apiClient.get('/voice/labeling/calibration');
    return response.data;
  },

  mediaUrl: (id) => `/api/v1${projectPath(id)}/media`,

  rttmUrl: (id, { names = false, source = 'edited' } = {}) => (
    `/api/v1${projectPath(id)}/rttm?names=${names ? 1 : 0}&source=${source}`
  ),
};

export default voiceLabelingAPI;

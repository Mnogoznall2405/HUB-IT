import apiClient from './client';

export const voiceVoicesAPI = {
  list: async (options = {}) => {
    const response = await apiClient.get('/voice/voices', { signal: options?.signal });
    return response.data;
  },

  sampleUrl: (name, file = null) => (
    `/api/v1/voice/voices/${encodeURIComponent(name)}/sample${file ? `?file=${encodeURIComponent(file)}` : ''}`
  ),

  enroll: async (name, file, replace = false) => {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', file);
    if (replace) formData.append('replace', '1');
    const response = await apiClient.post('/voice/voices', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 5 * 60 * 1000,
    });
    return response.data;
  },

  remove: async (name) => {
    const response = await apiClient.delete(`/voice/voices/${encodeURIComponent(name)}`);
    return response.data;
  },
};

export default voiceVoicesAPI;

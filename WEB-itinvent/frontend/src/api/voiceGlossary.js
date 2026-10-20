import apiClient from './client';

const termPath = (id) => `/voice/glossary/${encodeURIComponent(id)}`;

export const voiceGlossaryAPI = {
  // { items: [term], counts: { candidate, confirmed, rejected } }
  list: async (params = {}, options = {}) => {
    const response = await apiClient.get('/voice/glossary', { params, signal: options?.signal });
    return response.data;
  },

  create: async (payload) => {
    const response = await apiClient.post('/voice/glossary', payload);
    return response.data;
  },

  update: async (id, payload) => {
    const response = await apiClient.put(termPath(id), payload);
    return response.data;
  },

  remove: async (id) => {
    const response = await apiClient.delete(termPath(id));
    return response.data;
  },
};

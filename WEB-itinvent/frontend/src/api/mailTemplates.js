import apiClient from './client';

export const mailTemplatesAPI = {
  getTemplates: async (params = {}) => {
    const response = await apiClient.get('/mail/templates', { params });
    return response.data;
  },

  createTemplate: async (payload) => {
    const response = await apiClient.post('/mail/templates', payload);
    return response.data;
  },

  updateTemplate: async (templateId, payload) => {
    const response = await apiClient.patch(`/mail/templates/${encodeURIComponent(templateId)}`, payload);
    return response.data;
  },

  deleteTemplate: async (templateId) => {
    const response = await apiClient.delete(`/mail/templates/${encodeURIComponent(templateId)}`);
    return response.data;
  },
};

export default mailTemplatesAPI;

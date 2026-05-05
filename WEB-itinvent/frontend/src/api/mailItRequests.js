import apiClient from './client';

export const mailItRequestsAPI = {
  sendItRequest: async (payload) => {
    const response = await apiClient.post('/mail/messages/send-it-request', payload);
    return response.data;
  },

  sendItRequestMultipart: async ({
    templateId,
    fields,
    files,
    onUploadProgress,
    signal,
  }) => {
    const formData = new FormData();
    formData.append('template_id', String(templateId || ''));
    formData.append('fields_json', JSON.stringify(fields || {}));
    if (Array.isArray(files) && files.length > 0) {
      files.forEach((file) => {
        if (file) {
          formData.append('files', file);
        }
      });
    }
    const response = await apiClient.post('/mail/messages/send-it-request-multipart', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
      signal,
    });
    return response.data;
  },
};

export default mailItRequestsAPI;

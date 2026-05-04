import apiClient from './client';

export const hubTaskFilesAPI = {
  uploadTaskAttachment: async ({ taskId, file }) => {
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    }
    const response = await apiClient.post(`/hub/tasks/${encodeURIComponent(taskId)}/attachments`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  downloadTaskAttachment: async ({ taskId, attachmentId }) => {
    const response = await apiClient.get(
      `/hub/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
      { responseType: 'blob' },
    );
    return response;
  },

  downloadTaskReport: async (reportId) => {
    const response = await apiClient.get(`/hub/tasks/reports/${encodeURIComponent(reportId)}/file`, {
      responseType: 'blob',
    });
    return response;
  },
};

export default hubTaskFilesAPI;

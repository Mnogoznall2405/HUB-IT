import apiClient from './client';

const fileUrl = (fileId, suffix = '') => `/my-files/${encodeURIComponent(fileId)}/office${suffix}`;

export const myFilesOfficeAPI = {
  getStatus: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/office/status', { signal });
    return response.data;
  },
  getEditorConfig: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(fileUrl(fileId, '/config'), { signal });
    return response.data;
  },
  listSharedWithMe: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/office/shared-with-me', { signal });
    return response.data;
  },
  listCollaborators: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(fileUrl(fileId, '/collaborators'), { signal });
    return response.data;
  },
  setCollaborators: async (fileId, userIds) => {
    const response = await apiClient.put(fileUrl(fileId, '/collaborators'), {
      user_ids: (userIds || []).map(Number),
    });
    return response.data;
  },
  listVersions: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(fileUrl(fileId, '/versions'), { signal });
    return response.data;
  },
  restoreVersion: async (fileId, versionId) => {
    await apiClient.post(fileUrl(fileId, `/versions/${encodeURIComponent(versionId)}/restore`));
  },
};

export default myFilesOfficeAPI;

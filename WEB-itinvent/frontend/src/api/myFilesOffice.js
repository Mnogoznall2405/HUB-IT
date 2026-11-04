import apiClient from './client';

const fileUrl = (fileId, suffix = '') => `/my-files/${encodeURIComponent(fileId)}/office${suffix}`;
const folderUrl = (folderId) => `/my-files/office/folders/${encodeURIComponent(folderId)}/collaborators`;

export const myFilesOfficeAPI = {
  getStatus: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/office/status', { signal });
    return response.data;
  },
  createBlank: async ({ kind, name = '', folderId = null, libraryId = null } = {}) => {
    const response = await apiClient.post('/my-files/office/new', {
      kind,
      name: String(name || '').trim() || null,
      folder_id: folderId || null,
      library_id: libraryId || null,
    });
    return response.data;
  },
  getEditorConfig: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(fileUrl(fileId, '/config'), { signal });
    return response.data;
  },
  renameDocument: async (fileId, name, { signal } = {}) => {
    const response = await apiClient.post(fileUrl(fileId, '/rename'), { name }, { signal });
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
  setCollaborators: async (fileId, members) => {
    const response = await apiClient.put(fileUrl(fileId, '/collaborators'), {
      members: (members || []).map((item) => ({ user_id: Number(item.user_id), role: String(item.role || 'edit') })),
    });
    return response.data;
  },
  listFolderCollaborators: async (folderId, { signal } = {}) => {
    const response = await apiClient.get(folderUrl(folderId), { signal });
    return response.data;
  },
  setFolderCollaborators: async (folderId, members) => {
    const response = await apiClient.put(folderUrl(folderId), {
      members: (members || []).map((item) => ({ user_id: Number(item.user_id), role: String(item.role || 'edit') })),
    });
    return response.data;
  },
  getPublicAccess: async (token, { signal } = {}) => {
    const response = await apiClient.get(`/my-files/public/${encodeURIComponent(token)}/editor`, { signal });
    return response.data;
  },
  listGroups: async ({ signal } = {}) => {
    const response = await apiClient.get('/my-files/office/groups', { signal });
    return response.data;
  },
  listGroupMembers: async (groupId, { signal } = {}) => {
    const response = await apiClient.get(`/my-files/office/groups/${encodeURIComponent(groupId)}/members`, { signal });
    return response.data;
  },
  listVersions: async (fileId, { signal } = {}) => {
    const response = await apiClient.get(fileUrl(fileId, '/versions'), { signal });
    return response.data;
  },
  downloadVersion: async (fileId, versionId) => (
    apiClient.get(fileUrl(fileId, `/versions/${encodeURIComponent(versionId)}/download`), { responseType: 'blob' })
  ),
  restoreVersion: async (fileId, versionId) => {
    await apiClient.post(fileUrl(fileId, `/versions/${encodeURIComponent(versionId)}/restore`));
  },
};

export default myFilesOfficeAPI;

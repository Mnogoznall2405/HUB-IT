import apiClient from './client';

export const DOCFLOW_1C_QUERY_TIMEOUT_MS = 95_000;

const noStore = {
  headers: { 'Cache-Control': 'no-store' },
};

export const docflowAPI = {
  getProfile: async () => {
    const { data } = await apiClient.get('/docflow/profile', noStore);
    return data;
  },

  testCredentials: async ({ login, password }) => {
    const { data } = await apiClient.post(
      '/docflow/profile/test',
      { login, password },
      { timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
    return data;
  },

  saveCredentials: async ({ login, password }) => {
    const { data } = await apiClient.put(
      '/docflow/profile/credentials',
      { login, password },
      { timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
    return data;
  },

  deleteCredentials: async () => {
    await apiClient.delete('/docflow/profile/credentials');
  },

  listTasks: async ({ scope = 'inbox', q = '', limit = 50 } = {}) => {
    const { data } = await apiClient.get('/docflow/tasks', {
      params: { scope, q, limit },
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getInboxSummary: async () => {
    const { data } = await apiClient.get('/docflow/inbox-summary', {
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getAssignmentCapability: async () => {
    const { data } = await apiClient.get('/docflow/assignments/capability', noStore);
    return data;
  },

  searchAssignmentDocuments: async ({ q = '', limit = 20 } = {}) => {
    const { data } = await apiClient.get('/docflow/assignments/documents', {
      params: { q, limit },
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  searchAssignmentAssignees: async ({ q = '', limit = 20 } = {}) => {
    const { data } = await apiClient.get('/docflow/assignments/assignees', {
      params: { q, limit },
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  createAssignment: async (payload, idempotencyKey) => {
    const { data } = await apiClient.post('/docflow/assignments', payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  getAssignmentCommand: async (commandId) => {
    const { data } = await apiClient.get(
      `/docflow/assignments/commands/${encodeURIComponent(commandId)}`,
      { ...noStore, timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS },
    );
    return data;
  },

  getTask: async (taskRef) => {
    const { data } = await apiClient.get(`/docflow/tasks/${encodeURIComponent(taskRef)}`, {
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  applyTaskAction: async (taskRef, payload, idempotencyKey) => {
    const { data } = await apiClient.post(
      `/docflow/tasks/${encodeURIComponent(taskRef)}/actions`,
      payload,
      {
        headers: { 'Idempotency-Key': idempotencyKey },
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      },
    );
    return data;
  },

  getCommand: async (commandId) => {
    const { data } = await apiClient.get(`/docflow/commands/${encodeURIComponent(commandId)}`, {
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },

  downloadFile: (taskRef, fileRef, { disposition = 'attachment' } = {}) => (
    apiClient.get(
      `/docflow/tasks/${encodeURIComponent(taskRef)}/files/${encodeURIComponent(fileRef)}/content`,
      {
        params: { disposition },
        responseType: 'blob',
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      },
    )
  ),

  downloadFilePreviewPdf: (taskRef, fileRef) => (
    apiClient.get(
      `/docflow/tasks/${encodeURIComponent(taskRef)}/files/${encodeURIComponent(fileRef)}/preview/pdf`,
      {
        responseType: 'blob',
        timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
      },
    )
  ),

  getMetadata: async () => {
    const { data } = await apiClient.get('/docflow/metadata', {
      ...noStore,
      timeout: DOCFLOW_1C_QUERY_TIMEOUT_MS,
    });
    return data;
  },
};

export default docflowAPI;

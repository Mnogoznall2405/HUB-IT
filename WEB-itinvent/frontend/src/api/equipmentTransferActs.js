import apiClient from './client';

export const UPLOADED_ACT_PARSE_TIMEOUT_MS = 180_000;

export const equipmentTransferActsAPI = {
  getEquipmentActs: async (invNo) => {
    const response = await apiClient.get(`/equipment/${invNo}/acts`);
    return response.data;
  },

  searchActs: async (query, { limit = 50 } = {}) => {
    const q = String(query || '').trim();
    const response = await apiClient.get('/equipment/acts/search', {
      params: {
        q,
        limit,
      },
    });
    return response.data;
  },

  downloadEquipmentActFile: async (docNo, params = {}) => {
    const response = await apiClient.get(`/equipment/acts/${docNo}/file`, {
      params,
      responseType: 'blob',
    });
    return response;
  },

  parseUploadedAct: async (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    const manualMode = Boolean(options?.manualMode);
    const response = await apiClient.post('/equipment/acts/upload/parse', formData, {
      params: manualMode ? { manual_mode: true } : undefined,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: UPLOADED_ACT_PARSE_TIMEOUT_MS,
    });
    return response.data;
  },

  getUploadedActDraft: async (draftId) => {
    const response = await apiClient.get(`/equipment/acts/upload/draft/${encodeURIComponent(draftId)}`);
    return response.data;
  },

  getTransferReminder: async (reminderId) => {
    const response = await apiClient.get(`/equipment/transfer/reminders/${encodeURIComponent(reminderId)}`);
    return response.data;
  },

  commitUploadedActDraft: async (payload) => {
    const response = await apiClient.post('/equipment/acts/upload/commit', payload);
    return response.data;
  },

  sendUploadedActEmail: async (payload) => {
    const response = await apiClient.post('/equipment/acts/upload/email', payload);
    return response.data;
  },

  transfer: async (payload) => {
    const response = await apiClient.post('/equipment/transfer', payload);
    return response.data;
  },

  transferLocation: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/location', payload);
    return response.data;
  },

  createTransferActOnly: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/act-only', payload);
    return response.data;
  },

  getTransferActJob: async (jobId) => {
    const response = await apiClient.get(`/equipment/transfer/act-jobs/${encodeURIComponent(jobId)}`);
    return response.data;
  },

  sendTransferActsEmail: async (payload) => {
    const response = await apiClient.post('/equipment/transfer/email', payload);
    return response.data;
  },

  downloadTransferAct: async (actId) => {
    const response = await apiClient.get(`/equipment/transfer/act/${actId}`, {
      responseType: 'blob',
    });
    return response;
  },
};

export default equipmentTransferActsAPI;

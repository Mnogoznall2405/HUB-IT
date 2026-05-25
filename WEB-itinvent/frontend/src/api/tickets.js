import apiClient from './client';

const csv = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined && item !== '').join(',');
  }
  return value;
};

const compactParams = (params = {}) => (
  Object.entries(params).reduce((acc, [key, value]) => {
    if (value === undefined || value === null || value === '') return acc;
    const normalized = csv(value);
    if (normalized === '') return acc;
    acc[key] = normalized;
    return acc;
  }, {})
);

const downloadBlob = async (url, params = {}) => {
  const response = await apiClient.get(url, {
    params: compactParams(params),
    responseType: 'blob',
  });
  return response.data;
};

export const ticketsAPI = {
  listRequests: async (params = {}) => {
    const response = await apiClient.get('/tickets/requests', { params: compactParams(params) });
    return response.data;
  },
  getRequest: async (requestId) => {
    const response = await apiClient.get(`/tickets/requests/${encodeURIComponent(requestId)}`);
    return response.data;
  },
  createRequest: async (payload) => {
    const response = await apiClient.post('/tickets/requests', payload);
    return response.data;
  },
  updateRequest: async (requestId, payload) => {
    const response = await apiClient.patch(`/tickets/requests/${encodeURIComponent(requestId)}`, payload);
    return response.data;
  },
  changeStatus: async (requestId, payload) => {
    const response = await apiClient.patch(`/tickets/requests/${encodeURIComponent(requestId)}/status`, payload);
    return response.data;
  },
  listComments: async (requestId, params = {}) => {
    const response = await apiClient.get(`/tickets/requests/${encodeURIComponent(requestId)}/comments`, { params: compactParams(params) });
    return response.data;
  },
  addComment: async (requestId, payload) => {
    const response = await apiClient.post(`/tickets/requests/${encodeURIComponent(requestId)}/comments`, payload);
    return response.data;
  },
  listHistory: async (requestId, params = {}) => {
    const response = await apiClient.get(`/tickets/requests/${encodeURIComponent(requestId)}/history`, { params: compactParams(params) });
    return response.data;
  },
  listAttachments: async (requestId) => {
    const response = await apiClient.get(`/tickets/requests/${encodeURIComponent(requestId)}/attachments`);
    return response.data;
  },
  uploadAttachment: async (requestId, { file, fileType = 'other' }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);
    const response = await apiClient.post(`/tickets/requests/${encodeURIComponent(requestId)}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  deleteAttachment: async (requestId, attachmentId) => {
    const response = await apiClient.delete(`/tickets/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}`);
    return response.data;
  },
  downloadAttachment: async (requestId, attachmentId) => (
    downloadBlob(`/tickets/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}`)
  ),
  listObjects: async (params = {}) => {
    const response = await apiClient.get('/tickets/objects', { params: compactParams(params) });
    return response.data;
  },
  createObject: async (payload) => {
    const response = await apiClient.post('/tickets/objects', payload);
    return response.data;
  },
  updateObject: async (objectId, payload) => {
    const response = await apiClient.patch(`/tickets/objects/${encodeURIComponent(objectId)}`, payload);
    return response.data;
  },
  listEmployees: async (params = {}) => {
    const response = await apiClient.get('/tickets/employees', { params: compactParams(params) });
    return response.data;
  },
  getEmployee: async (employeeId) => {
    const response = await apiClient.get(`/tickets/employees/${encodeURIComponent(employeeId)}`);
    return response.data;
  },
  createEmployee: async (payload) => {
    const response = await apiClient.post('/tickets/employees', payload);
    return response.data;
  },
  updateEmployee: async (employeeId, payload) => {
    const response = await apiClient.patch(`/tickets/employees/${encodeURIComponent(employeeId)}`, payload);
    return response.data;
  },
  uploadImport: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiClient.post('/tickets/import/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
  getImportPreview: async (jobId) => {
    const response = await apiClient.get(`/tickets/import/${encodeURIComponent(jobId)}/preview`);
    return response.data;
  },
  executeImport: async (jobId, payload) => {
    const response = await apiClient.post(`/tickets/import/${encodeURIComponent(jobId)}/execute`, payload);
    return response.data;
  },
  getLossesReport: async (params = {}) => {
    const response = await apiClient.get('/tickets/reports/losses', { params: compactParams(params) });
    return response.data;
  },
  exportLosses: async (params = {}) => downloadBlob('/tickets/reports/losses/export', params),
  exportRequests: async (params = {}) => downloadBlob('/tickets/reports/requests/export', params),
  getDashboard: async () => {
    const response = await apiClient.get('/tickets/dashboard');
    return response.data;
  },
  getKanban: async (params = {}) => {
    const response = await apiClient.get('/tickets/kanban', { params: compactParams(params) });
    return response.data;
  },
  listFinancialOps: async (params = {}) => {
    const response = await apiClient.get('/tickets/financial-ops', { params: compactParams(params) });
    return response.data;
  },
  createFinancialOp: async (payload) => {
    const response = await apiClient.post('/tickets/financial-ops', payload);
    return response.data;
  },
  updateFinancialOp: async (opId, payload) => {
    const response = await apiClient.patch(`/tickets/financial-ops/${encodeURIComponent(opId)}`, payload);
    return response.data;
  },
  deleteFinancialOp: async (opId) => {
    const response = await apiClient.delete(`/tickets/financial-ops/${encodeURIComponent(opId)}`);
    return response.data;
  },
  getNotificationRules: async () => {
    const response = await apiClient.get('/tickets/notifications/rules');
    return response.data;
  },
  updateNotificationRule: async (ruleId, payload) => {
    const response = await apiClient.patch(`/tickets/notifications/rules/${encodeURIComponent(ruleId)}`, payload);
    return response.data;
  },
  getPendingNotifications: async () => {
    const response = await apiClient.get('/tickets/notifications/pending');
    return response.data;
  },
  dismissNotification: async (notificationId) => {
    const response = await apiClient.post(`/tickets/notifications/${encodeURIComponent(notificationId)}/dismiss`);
    return response.data;
  },
};

export default ticketsAPI;

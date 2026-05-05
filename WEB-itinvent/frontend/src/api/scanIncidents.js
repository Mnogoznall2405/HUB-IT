import apiClient from './client';

export const scanIncidentsAPI = {
  getIncidents: async (params = {}, options = {}) => {
    const response = await apiClient.get('/scan/incidents', { params, signal: options?.signal });
    return response.data;
  },

  getHostScanRuns: async (hostname, params = {}) => {
    const response = await apiClient.get(`/scan/hosts/${encodeURIComponent(hostname)}/scan-runs`, { params });
    return response.data;
  },

  getTaskObservations: async (taskId, params = {}) => {
    const response = await apiClient.get(`/scan/tasks/${encodeURIComponent(taskId)}/observations`, { params });
    return response.data;
  },

  exportScanTaskIncidents: async (taskId) => {
    const response = await apiClient.get(`/scan/tasks/${encodeURIComponent(taskId)}/incidents/export`, {
      responseType: 'blob',
    });
    return response;
  },

  ackIncident: async (incidentId, ackBy = '') => {
    const response = await apiClient.post(`/scan/incidents/${encodeURIComponent(incidentId)}/ack`, {
      ack_by: ackBy,
    });
    return response.data;
  },

  ackIncidentsBatch: async (payload = {}) => {
    const response = await apiClient.post('/scan/incidents/bulk-ack', payload);
    return response.data;
  },
};

export default scanIncidentsAPI;

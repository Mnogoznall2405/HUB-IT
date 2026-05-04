import apiClient from './client';

export const networksAPI = {
  getBranches: async (city = 'tmn') => {
    const response = await apiClient.get('/networks/branches', { params: { city } });
    return response.data;
  },

  createBranch: async (payload) => {
    const response = await apiClient.post('/networks/branches', payload);
    return response.data;
  },

  updateBranch: async (branchId, data) => {
    const response = await apiClient.patch(`/networks/branches/${branchId}`, data);
    return response.data;
  },

  deleteBranch: async (branchId) => {
    const response = await apiClient.delete(`/networks/branches/${branchId}`);
    return response.data;
  },

  getBranchOverview: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/overview`);
    return response.data;
  },

  getDevices: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/devices`);
    return response.data;
  },

  getPorts: async (deviceId, params = {}) => {
    const response = await apiClient.get(`/networks/devices/${deviceId}/ports`, { params });
    return response.data;
  },

  getBranchPorts: async (branchId, params = {}) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/ports`, { params });
    return response.data;
  },

  getBranchSockets: async (branchId, params = {}) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/sockets`, { params });
    return response.data;
  },

  createSocket: async (branchId, payload) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets`, payload);
    return response.data;
  },

  updateSocket: async (socketId, payload) => {
    const response = await apiClient.patch(`/networks/sockets/${socketId}`, payload);
    return response.data;
  },

  deleteSocket: async (socketId) => {
    const response = await apiClient.delete(`/networks/sockets/${socketId}`);
    return response.data;
  },

  bootstrapSockets: async (branchId, payload = {}) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/bootstrap`, payload);
    return response.data;
  },

  importSocketsTemplate: async (branchId, formData) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/import`, formData);
    return response.data;
  },

  importEquipment: async (branchId, formData) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/equipment/import`, formData);
    return response.data;
  },

  getBranchDbMapping: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/db-mapping`);
    return response.data;
  },

  updateBranchDbMapping: async (branchId, payload) => {
    const response = await apiClient.patch(`/networks/branches/${branchId}/db-mapping`, payload);
    return response.data;
  },

  syncSocketHostContext: async (branchId, payload = {}) => {
    const response = await apiClient.post(`/networks/branches/${branchId}/sockets/sync-host-context`, payload);
    return response.data;
  },

  resolveSocketFio: async (branchId, payload = {}) => {
    // Backward compatibility alias; prefer syncSocketHostContext in new code.
    return networksAPI.syncSocketHostContext(branchId, payload);
  },

  getMaps: async (branchId) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/maps`);
    return response.data;
  },

  getMapPoints: async (branchId, mapId = null) => {
    const response = await apiClient.get(`/networks/branches/${branchId}/map-points`, {
      params: { map_id: mapId || undefined },
    });
    return response.data;
  },

  getAudit: async (params = {}) => {
    const response = await apiClient.get('/networks/audit', { params });
    return response.data;
  },

  importData: async (formData) => {
    const response = await apiClient.post('/networks/import', formData);
    return response.data;
  },

  createDevice: async (payload) => {
    const response = await apiClient.post('/networks/devices', payload);
    return response.data;
  },

  updateDevice: async (deviceId, payload) => {
    const response = await apiClient.patch(`/networks/devices/${deviceId}`, payload);
    return response.data;
  },

  deleteDevice: async (deviceId) => {
    const response = await apiClient.delete(`/networks/devices/${deviceId}`);
    return response.data;
  },

  bootstrapDevicePorts: async (deviceId, payload) => {
    const response = await apiClient.post(`/networks/devices/${deviceId}/bootstrap-ports`, payload);
    return response.data;
  },

  createPort: async (payload) => {
    const response = await apiClient.post('/networks/ports', payload);
    return response.data;
  },

  updatePort: async (portId, payload) => {
    const response = await apiClient.patch(`/networks/ports/${portId}`, payload);
    return response.data;
  },

  deletePort: async (portId) => {
    const response = await apiClient.delete(`/networks/ports/${portId}`);
    return response.data;
  },

  uploadMap: async (formData) => {
    const response = await apiClient.post('/networks/maps/upload', formData);
    return response.data;
  },

  updateMap: async (mapId, payload) => {
    const response = await apiClient.patch(`/networks/maps/${mapId}`, payload);
    return response.data;
  },

  deleteMap: async (mapId) => {
    const response = await apiClient.delete(`/networks/maps/${mapId}`);
    return response.data;
  },

  createMapPoint: async (payload) => {
    const response = await apiClient.post('/networks/map-points', payload);
    return response.data;
  },

  updateMapPoint: async (pointId, payload) => {
    const response = await apiClient.patch(`/networks/map-points/${pointId}`, payload);
    return response.data;
  },

  deleteMapPoint: async (pointId) => {
    const response = await apiClient.delete(`/networks/map-points/${pointId}`);
    return response.data;
  },

  downloadMapFile: async (mapId, params = {}) => {
    const response = await apiClient.get(`/networks/maps/${mapId}/file`, {
      params,
      responseType: 'blob',
    });
    return response;
  },

  exportMapPdf: async (mapId, params = {}) => {
    const response = await apiClient.get(`/networks/maps/${mapId}/export-pdf`, {
      params,
      responseType: 'blob',
    });
    return response;
  },
};

export default networksAPI;

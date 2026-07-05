import apiClient from './client';

export const equipmentComputersAPI = {
  getAgentComputers: async (options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const branch = String(options?.branch || '').trim();
    const status = String(options?.status || '').trim().toLowerCase();
    const outlookStatus = String(options?.outlookStatus || '').trim().toLowerCase();
    const searchQuery = String(options?.q || '').trim();
    const sortBy = String(options?.sortBy || '').trim();
    const sortDir = String(options?.sortDir || '').trim().toLowerCase();
    const changedOnly = Boolean(options?.changedOnly);
    const params = { scope };
    if (branch) {
      params.branch = branch;
    }
    if (['online', 'stale', 'offline', 'unknown'].includes(status)) {
      params.status = status;
    }
    if (['ok', 'warning', 'critical', 'unknown'].includes(outlookStatus)) {
      params.outlook_status = outlookStatus;
    }
    if (searchQuery) {
      params.q = searchQuery;
    }
    if (changedOnly) {
      params.changed_only = true;
    }
    if (sortBy) {
      params.sort_by = sortBy;
    }
    if (['asc', 'desc'].includes(sortDir)) {
      params.sort_dir = sortDir;
    }
    const response = await apiClient.get('/inventory/computers', {
      params,
    });
    return response.data;
  },

  searchAgentComputers: async (options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const branch = String(options?.branch || '').trim();
    const status = String(options?.status || '').trim().toLowerCase();
    const outlookStatus = String(options?.outlookStatus || '').trim().toLowerCase();
    const searchQuery = String(options?.q || '').trim();
    const searchFields = Array.isArray(options?.searchFields)
      ? options.searchFields.map((item) => String(item || '').trim()).filter(Boolean).join(',')
      : String(options?.searchFields || '').trim();
    const sortBy = String(options?.sortBy || '').trim();
    const sortDir = String(options?.sortDir || '').trim().toLowerCase();
    const changedOnly = Boolean(options?.changedOnly);
    const limit = Number(options?.limit || 50);
    const offset = Number(options?.offset || 0);
    const params = {
      scope,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50,
      offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
      include_summary: options?.includeSummary === true,
    };
    if (branch) {
      params.branch = branch;
    }
    if (['online', 'stale', 'offline', 'unknown'].includes(status)) {
      params.status = status;
    }
    if (['ok', 'warning', 'critical', 'unknown'].includes(outlookStatus)) {
      params.outlook_status = outlookStatus;
    }
    if (searchQuery) {
      params.q = searchQuery;
    }
    if (searchFields) {
      params.search_fields = searchFields;
    }
    if (changedOnly) {
      params.changed_only = true;
    }
    if (sortBy) {
      params.sort_by = sortBy;
    }
    if (['asc', 'desc'].includes(sortDir)) {
      params.sort_dir = sortDir;
    }
    const response = await apiClient.get('/inventory/computers/search', {
      params,
    });
    return response.data;
  },

  getAgentComputerChanges: async (limit = 50) => {
    const response = await apiClient.get('/inventory/changes', {
      params: { limit },
    });
    return response.data;
  },

  getComputersSummary: async (options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const branch = String(options?.branch || '').trim();
    const status = String(options?.status || '').trim().toLowerCase();
    const outlookStatus = String(options?.outlookStatus || '').trim().toLowerCase();
    const searchQuery = String(options?.q || '').trim();
    const searchFields = Array.isArray(options?.searchFields)
      ? options.searchFields.map((item) => String(item || '').trim()).filter(Boolean).join(',')
      : String(options?.searchFields || '').trim();
    const changedOnly = Boolean(options?.changedOnly);
    const params = { scope };
    if (branch) {
      params.branch = branch;
    }
    if (['online', 'stale', 'offline', 'unknown'].includes(status)) {
      params.status = status;
    }
    if (['ok', 'warning', 'critical', 'unknown'].includes(outlookStatus)) {
      params.outlook_status = outlookStatus;
    }
    if (searchQuery) {
      params.q = searchQuery;
    }
    if (searchFields) {
      params.search_fields = searchFields;
    }
    if (changedOnly) {
      params.changed_only = true;
    }
    const response = await apiClient.get('/inventory/computers/summary', { params });
    return response.data;
  },

  getAgentComputer: async (macAddress, options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const normalizedMac = encodeURIComponent(String(macAddress || '').trim());
    const response = await apiClient.get(`/inventory/computers/${normalizedMac}`, {
      params: { scope },
    });
    return response.data;
  },
};

export default equipmentComputersAPI;

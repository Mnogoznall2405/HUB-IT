import apiClient from './client';

function buildComputerFilterParams(options = {}) {
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
  const hiddenOnly = Boolean(options?.hiddenOnly);
  const includeHidden = Boolean(options?.includeHidden);
  const hideVm172 = Boolean(options?.hideVm172);
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
  if (hiddenOnly) {
    params.hidden_only = true;
  } else if (includeHidden) {
    params.include_hidden = true;
  }
  if (hideVm172) {
    params.hide_vm_172 = true;
  }
  if (sortBy) {
    params.sort_by = sortBy;
  }
  if (['asc', 'desc'].includes(sortDir)) {
    params.sort_dir = sortDir;
  }
  return params;
}

export const equipmentComputersAPI = {
  getAgentComputers: async (options = {}) => {
    const params = buildComputerFilterParams(options);
    const response = await apiClient.get('/inventory/computers', {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  searchAgentComputers: async (options = {}) => {
    const limit = Number(options?.limit || 50);
    const offset = Number(options?.offset || 0);
    const params = {
      ...buildComputerFilterParams(options),
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 50,
      offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
      include_summary: options?.includeSummary === true,
    };
    const response = await apiClient.get('/inventory/computers/search', {
      params,
      signal: options?.signal,
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
    const params = buildComputerFilterParams(options);
    const response = await apiClient.get('/inventory/computers/summary', {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  getAgentComputer: async (macAddress, options = {}) => {
    const scope = String(options?.scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected';
    const normalizedMac = encodeURIComponent(String(macAddress || '').trim());
    const response = await apiClient.get(`/inventory/computers/${normalizedMac}`, {
      params: { scope },
      signal: options?.signal,
    });
    return response.data;
  },

  hideComputer: async (macAddress, options = {}) => {
    const normalizedMac = encodeURIComponent(String(macAddress || '').trim());
    const reason = String(options?.reason || '').trim();
    const params = {};
    if (reason) {
      params.reason = reason;
    }
    const response = await apiClient.post(`/inventory/computers/${normalizedMac}/hide`, null, {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  unhideComputer: async (macAddress, options = {}) => {
    const normalizedMac = encodeURIComponent(String(macAddress || '').trim());
    const response = await apiClient.post(`/inventory/computers/${normalizedMac}/unhide`, null, {
      signal: options?.signal,
    });
    return response.data;
  },
};

export default equipmentComputersAPI;

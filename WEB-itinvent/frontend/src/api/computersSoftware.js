import apiClient from './http';

export const computersSoftwareAPI = {
  // Installs of a program across the visible computers (software inventory of the agent).
  searchSoftware: async ({ q, versionBelow = '', scope = 'selected', limit = 200, signal } = {}) => {
    const params = {
      q: String(q || '').trim(),
      scope: String(scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected',
      limit: Math.max(1, Math.min(1000, Number(limit) || 200)),
    };
    const versionLimit = String(versionBelow || '').trim();
    if (versionLimit) {
      params.version_below = versionLimit;
    }
    const response = await apiClient.get('/inventory/computers/software/search', { params, signal });
    return response.data;
  },

  // One row per computer: installed version or null + whether the inventory ran at all.
  getSoftwarePresence: async ({ q, match = 'exact', scope = 'all', limit = 10000, signal } = {}) => {
    const params = {
      q: String(q || '').trim(),
      match: String(match || 'exact').toLowerCase() === 'contains' ? 'contains' : 'exact',
      scope: String(scope || 'all').toLowerCase() === 'selected' ? 'selected' : 'all',
      limit: Math.max(1, Math.min(10000, Number(limit) || 10000)),
    };
    const response = await apiClient.get('/inventory/computers/software/presence', { params, signal });
    return response.data;
  },
};

export default computersSoftwareAPI;

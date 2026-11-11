import apiClient from './client';

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
};

export default computersSoftwareAPI;

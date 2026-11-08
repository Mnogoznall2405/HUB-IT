import apiClient from './client';

export const computersUsbAPI = {
  // USB devices ever seen by the agents (vendor, product, name, serial or PNP id).
  searchUsb: async ({ q, presentOnly = false, scope = 'selected', limit = 200, signal } = {}) => {
    const params = {
      q: String(q || '').trim(),
      scope: String(scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected',
      present_only: presentOnly === true,
      limit: Math.max(1, Math.min(1000, Number(limit) || 200)),
    };
    const response = await apiClient.get('/inventory/computers/usb/search', { params, signal });
    return response.data;
  },
};

export default computersUsbAPI;

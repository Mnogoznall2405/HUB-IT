import apiClient from './client';

export const computersFleetAPI = {
  // Состояние парка агентов: давность отчётов, версии, fs_egress/scan, очереди, проблемные компьютеры.
  getHealth: async ({ scope = 'selected', limit = 500, signal } = {}) => {
    const params = {
      scope: String(scope || 'selected').toLowerCase() === 'all' ? 'all' : 'selected',
      limit: Math.max(1, Math.min(2000, Number(limit) || 500)),
    };
    const response = await apiClient.get('/inventory/computers/fleet/health', { params, signal });
    return response.data;
  },
};

export default computersFleetAPI;

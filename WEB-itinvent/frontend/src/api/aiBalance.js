import apiClient from './client';

// AG: provider balance warning for AI managers (settings.ai.manage).
export const aiBalanceAPI = {
  async get() {
    return (await apiClient.get('/ai-bots/balance')).data;
  },
  async setThreshold(threshold) {
    return (await apiClient.put('/ai-bots/balance/settings', { threshold: Number(threshold) })).data;
  },
  async check() {
    return (await apiClient.post('/ai-bots/balance/check')).data;
  },
};

export default aiBalanceAPI;

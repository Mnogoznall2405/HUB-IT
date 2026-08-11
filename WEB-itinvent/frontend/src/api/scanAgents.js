import apiClient from './client';

export const scanAgentsAPI = {
  getAgents: async () => {
    const response = await apiClient.get('/scan/agents');
    return response.data;
  },

  getAgentsTable: async (params = {}, options = {}) => {
    const response = await apiClient.get('/scan/agents/table', { params, signal: options?.signal });
    return response.data;
  },

  getAgentsActivity: async (agentIds = []) => {
    const query = new URLSearchParams();
    (Array.isArray(agentIds) ? agentIds : []).forEach((agentId) => {
      const normalized = String(agentId || '').trim();
      if (normalized) query.append('agent_id', normalized);
    });
    const suffix = query.toString();
    const response = await apiClient.get(
      suffix ? `/scan/agents/activity?${suffix}` : '/scan/agents/activity',
    );
    return response.data;
  },
};

export default scanAgentsAPI;

import apiClient from './client';

const encodeInvNo = (invNo) => encodeURIComponent(String(invNo ?? '').trim());

export const equipmentRecentCardsAPI = {
  getRecentCards: async ({ limit = 8 } = {}) => {
    const response = await apiClient.get('/equipment/recent-cards', {
      params: { limit },
    });
    return response.data;
  },

  touchRecentCard: async ({ invNo, inv_no, actionType, action_type, snapshot } = {}) => {
    const response = await apiClient.post('/equipment/recent-cards/touch', {
      inv_no: String(invNo ?? inv_no ?? '').trim(),
      action_type: String(actionType ?? action_type ?? 'view').trim() || 'view',
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : undefined,
    });
    return response.data;
  },

  removeRecentCard: async (invNo) => {
    const response = await apiClient.delete(`/equipment/recent-cards/${encodeInvNo(invNo)}`);
    return response.data;
  },

  clearRecentCards: async () => {
    const response = await apiClient.delete('/equipment/recent-cards');
    return response.data;
  },
};

export default equipmentRecentCardsAPI;

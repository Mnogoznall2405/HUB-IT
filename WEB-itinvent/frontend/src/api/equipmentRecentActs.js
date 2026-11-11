import apiClient from './client';

const encodeDocNo = (docNo) => encodeURIComponent(String(docNo ?? '').trim());

export const equipmentRecentActsAPI = {
  getRecentActs: async ({ limit = 8 } = {}) => {
    const response = await apiClient.get('/equipment/acts/recent', {
      params: { limit },
    });
    return response.data;
  },

  touchRecentAct: async ({
    docNo,
    doc_no,
    docNumber,
    doc_number,
    actionType,
    action_type,
    snapshot,
  } = {}) => {
    const response = await apiClient.post('/equipment/acts/recent/touch', {
      doc_no: Number(docNo ?? doc_no) || 0,
      doc_number: String(docNumber ?? doc_number ?? '').trim(),
      action_type: String(actionType ?? action_type ?? 'view').trim() || 'view',
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : undefined,
    });
    return response.data;
  },

  removeRecentAct: async (docNo) => {
    const response = await apiClient.delete(`/equipment/acts/recent/${encodeDocNo(docNo)}`);
    return response.data;
  },

  clearRecentActs: async () => {
    const response = await apiClient.delete('/equipment/acts/recent');
    return response.data;
  },
};

export default equipmentRecentActsAPI;

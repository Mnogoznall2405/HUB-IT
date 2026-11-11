import apiClient from './client';

const encodeInvNo = (invNo) => encodeURIComponent(String(invNo || '').trim());

// Ручная отметка «сверено с 1С». Автоматическая сверка живёт отдельно
// (/warehouse-1c/employee-compare-summary) и эту отметку не затрагивает.
export const equipmentOneCMarksAPI = {
  list: async () => {
    const { data } = await apiClient.get('/equipment/one-c-marks');
    return data?.marks && typeof data.marks === 'object' ? data.marks : {};
  },
  // kind: 'ok' — сверено вручную, 'mismatch' — не сходится с 1С (нужен комментарий).
  set: async (invNo, note = '', kind = 'ok') => {
    const { data } = await apiClient.put(`/equipment/${encodeInvNo(invNo)}/one-c-mark`, { note, kind });
    return data?.mark || null;
  },
  clear: async (invNo) => {
    const { data } = await apiClient.delete(`/equipment/${encodeInvNo(invNo)}/one-c-mark`);
    return Boolean(data?.removed);
  },
};

export default equipmentOneCMarksAPI;

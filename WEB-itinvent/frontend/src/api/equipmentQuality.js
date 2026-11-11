import apiClient from './client';

// Панель качества данных: счётчики правил и строки, нарушающие правило (текущая база).
export const equipmentQualityAPI = {
  summary: async ({ refresh = false, dbId = '' } = {}) => {
    const response = await apiClient.get('/equipment/quality/summary', {
      params: { refresh: refresh || undefined, db_id: dbId || undefined },
    });
    return response.data;
  },

  issues: async ({
    rule, q = '', offset = 0, limit = 50, dbId = '',
  }) => {
    const response = await apiClient.get('/equipment/quality/issues', {
      params: {
        rule, q: q || undefined, offset, limit, db_id: dbId || undefined,
      },
    });
    return response.data;
  },

  // Правка прямо из строки панели: сервер сам приводит MAC к виду AA:BB:CC:DD:EE:FF.
  setMac: async ({ invNo, mac, dbId = '' }) => {
    const response = await apiClient.patch(
      `/equipment/${encodeURIComponent(String(invNo))}`,
      { mac_address: mac },
      dbId ? { headers: { 'X-Database-ID': dbId } } : undefined,
    );
    return response.data;
  },

  exportCsv: async ({ rule, q = '', dbId = '' }) => {
    const response = await apiClient.get('/equipment/quality/issues/export', {
      params: { rule, q: q || undefined, db_id: dbId || undefined },
      responseType: 'blob',
    });
    return response.data;
  },
};

export default equipmentQualityAPI;

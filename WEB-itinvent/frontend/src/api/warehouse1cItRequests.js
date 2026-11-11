import apiClient from './client';
import { WAREHOUSE_1C_QUERY_TIMEOUT_MS } from './warehouse1c';

export const warehouse1cItRequestsAPI = {
  getRequests: async ({
    view = 'active',
    search = '',
    stage = '',
    overdue,
    warehouseRef = '',
    limit = 25,
    cursor = '',
    refresh = false,
    signal,
  } = {}) => {
    const params = {
      view,
      q: search,
      stage,
      warehouse_ref: warehouseRef,
      limit,
      cursor,
      refresh,
    };
    if (typeof overdue === 'boolean') params.overdue = overdue;
    const { data } = await apiClient.get('/warehouse-1c/it-requests', {
      params,
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      signal,
    });
    return data;
  },

  getRequest: async (requestRef, { signal } = {}) => {
    const { data } = await apiClient.get(
      `/warehouse-1c/it-requests/${encodeURIComponent(String(requestRef || '').trim())}`,
      { timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS, signal },
    );
    return data;
  },
};

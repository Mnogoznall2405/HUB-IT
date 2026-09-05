import apiClient from './client';
import { WAREHOUSE_1C_QUERY_TIMEOUT_MS } from './warehouse1c';


export const constructionAPI = {
  getObjects: async ({
    search = '',
    kind = 'all',
    limit = 24,
    cursor = '',
    refresh = false,
    signal,
  } = {}) => {
    const { data } = await apiClient.get('/construction/objects', {
      params: {
        q: search,
        kind,
        limit,
        cursor,
        refresh,
      },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      signal,
    });
    return data;
  },
  getManagement: async ({ signal } = {}) => {
    const { data } = await apiClient.get('/construction/management', {
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      signal,
    });
    return data;
  },
  getObject: async (objectId, { signal } = {}) => {
    const { data } = await apiClient.get(
      `/construction/objects/${encodeURIComponent(String(objectId || '').trim())}`,
      { timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS, signal },
    );
    return data;
  },
  getObjectRequests: async (objectId, {
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
    const { data } = await apiClient.get(
      `/construction/objects/${encodeURIComponent(String(objectId || '').trim())}/requests`,
      { params, timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS, signal },
    );
    return data;
  },
  getObjectRequest: async (objectId, requestRef, { signal } = {}) => {
    const { data } = await apiClient.get(
      `/construction/objects/${encodeURIComponent(String(objectId || '').trim())}`
        + `/requests/${encodeURIComponent(String(requestRef || '').trim())}`,
      { timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS, signal },
    );
    return data;
  },
  searchEmployees: async (query, { limit = 30, signal } = {}) => {
    const { data } = await apiClient.get('/construction/employee-candidates', {
      params: { q: String(query || ''), limit },
      timeout: WAREHOUSE_1C_QUERY_TIMEOUT_MS,
      signal,
    });
    return data;
  },
  createManagedObject: async (payload) => {
    const { data } = await apiClient.post('/construction/management/objects', payload);
    return data;
  },
  updateManagedObject: async (objectId, payload) => {
    const { data } = await apiClient.put(
      `/construction/management/objects/${encodeURIComponent(objectId)}`,
      payload,
    );
    return data;
  },
};

export default constructionAPI;

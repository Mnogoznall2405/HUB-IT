import apiClient from './client';

const withDb = (dbId, config = {}) => {
  const id = String(dbId || '').trim();
  if (!id) return config;
  return { ...config, headers: { ...(config.headers || {}), 'X-Database-ID': id } };
};

const kindPath = (kind) => `/itinvent-references/${encodeURIComponent(String(kind))}`;

export const itinventReferencesAPI = {
  list: async (kind, { dbId, ...params } = {}) => {
    const response = await apiClient.get(kindPath(kind), withDb(dbId, { params }));
    return response.data;
  },

  usage: async (kind, id, { dbId, ciType } = {}) => {
    const response = await apiClient.get(
      `${kindPath(kind)}/${encodeURIComponent(String(id))}/usage`,
      withDb(dbId, { params: ciType ? { ci_type: ciType } : {} }),
    );
    return response.data;
  },

  create: async (kind, payload, { dbId } = {}) => {
    const response = await apiClient.post(kindPath(kind), payload, withDb(dbId));
    return response.data;
  },

  update: async (kind, id, payload, { dbId, ciType } = {}) => {
    const response = await apiClient.patch(
      `${kindPath(kind)}/${encodeURIComponent(String(id))}`,
      payload,
      withDb(dbId, { params: ciType ? { ci_type: ciType } : {} }),
    );
    return response.data;
  },

  remove: async (kind, id, { dbId, ciType } = {}) => {
    const response = await apiClient.delete(
      `${kindPath(kind)}/${encodeURIComponent(String(id))}`,
      withDb(dbId, { params: ciType ? { ci_type: ciType } : {} }),
    );
    return response.data;
  },
};

export const getReferenceErrorMessage = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  return fallback;
};

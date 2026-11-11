import apiClient from './client';

const DEPARTMENTS_LIST_TTL_MS = 10 * 60 * 1000;

let departmentsListCache = {
  key: '',
  fetchedAt: 0,
  payload: null,
};

let departmentsListInflight = null;

const normalizeListParams = (params = {}) => {
  const search = String(params.search || '').trim();
  return {
    search,
    force: Boolean(params.force),
  };
};

const buildListCacheKey = (params = {}) => {
  const { search } = normalizeListParams(params);
  if (search) return '';
  return 'default';
};

export const invalidateDepartmentsListCache = () => {
  departmentsListCache = {
    key: '',
    fetchedAt: 0,
    payload: null,
  };
  departmentsListInflight = null;
};

export const departmentsAPI = {
  list: async (params = {}) => {
    const normalized = normalizeListParams(params);
    const cacheKey = buildListCacheKey(params);
    const requestParams = normalized.search ? { search: normalized.search } : {};

    if (cacheKey && !normalized.force) {
      const cached = departmentsListCache;
      if (
        cached.key === cacheKey
        && cached.payload
        && (Date.now() - cached.fetchedAt) < DEPARTMENTS_LIST_TTL_MS
      ) {
        return cached.payload;
      }
      if (departmentsListInflight) {
        return departmentsListInflight;
      }
    }

    const fetchPromise = apiClient
      .get('/departments', { params: requestParams })
      .then((response) => {
        const data = response.data;
        if (cacheKey && !normalized.force) {
          departmentsListCache = {
            key: cacheKey,
            fetchedAt: Date.now(),
            payload: data,
          };
        }
        return data;
      })
      .finally(() => {
        if (departmentsListInflight === fetchPromise) {
          departmentsListInflight = null;
        }
      });

    if (cacheKey && !normalized.force) {
      departmentsListInflight = fetchPromise;
    }

    return fetchPromise;
  },

  getMembers: async (departmentId) => {
    const response = await apiClient.get(`/departments/${encodeURIComponent(departmentId)}/members`);
    return response.data;
  },

  setManagers: async (departmentId, managerUserIds = []) => {
    const response = await apiClient.put(`/departments/${encodeURIComponent(departmentId)}/managers`, {
      manager_user_ids: Array.isArray(managerUserIds) ? managerUserIds : [],
    });
    invalidateDepartmentsListCache();
    return response.data;
  },

  syncFromUsers: async () => {
    const response = await apiClient.post('/departments/sync-from-users');
    invalidateDepartmentsListCache();
    return response.data;
  },

  syncFromAD: async () => {
    const response = await apiClient.post('/departments/sync-from-ad');
    invalidateDepartmentsListCache();
    return response.data;
  },
};

export default departmentsAPI;

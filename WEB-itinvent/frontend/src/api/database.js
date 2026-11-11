import apiClient from './client';
import { buildCacheKey, getOrFetchSWR, invalidateSWRCacheByPrefix } from '../lib/swrCache';

const DATABASE_META_STALE_TIME_MS = 5 * 60 * 1000;

const normalizeDbId = (value) => String(value ?? '').trim();

const getSelectedDatabaseCachePart = () => {
  try {
    return normalizeDbId(window.localStorage.getItem('selected_database'));
  } catch {
    return '';
  }
};

const getCachedDatabaseGet = async (
  cacheScope,
  url,
  {
    staleTimeMs = DATABASE_META_STALE_TIME_MS,
    force = false,
  } = {},
) => {
  const cacheKey = buildCacheKey(
    'http-get',
    cacheScope,
    url,
    getSelectedDatabaseCachePart(),
    {},
  );
  const { data } = await getOrFetchSWR(
    cacheKey,
    async () => (await apiClient.get(url)).data,
    {
      staleTimeMs,
      force,
    },
  );
  return data;
};

export const databaseAPI = {
  getAvailableDatabases: async (options = {}) => (
    getCachedDatabaseGet('database-list', '/database/list', {
      force: Boolean(options?.force),
    })
  ),
  getCurrentDatabase: async (options = {}) => (
    getCachedDatabaseGet('database-current', '/database/current', {
      force: Boolean(options?.force),
    })
  ),
  switchDatabase: async (databaseId) => {
    const normalizedDatabaseId = normalizeDbId(databaseId);
    const response = await apiClient.post('/database/switch', { database_id: normalizedDatabaseId });
    invalidateSWRCacheByPrefix('http-get', 'database-current');
    invalidateSWRCacheByPrefix('http-get', 'database-list');
    return response.data;
  },
};

export default databaseAPI;

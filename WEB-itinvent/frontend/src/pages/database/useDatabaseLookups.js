import { useCallback } from 'react';

import { equipmentAPI } from '../../api/client';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import { normalizeDbId } from './databaseRecordModel';

export function useDatabaseLookups({ dbName, staleTimeMs = 30000 } = {}) {
  const getDbCacheScope = useCallback(
    () => normalizeDbId(localStorage.getItem('selected_database') || dbName || 'default'),
    [dbName]
  );

  const searchOwnersCached = useCallback(
    async (query, limit = 20) => {
      const normalizedQuery = String(query || '').trim().toLowerCase();
      const safeLimit = Number(limit || 20);
      const cacheKey = buildCacheKey('owners-search', getDbCacheScope(), normalizedQuery, safeLimit);
      const { data } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.searchOwners(query, limit),
        { staleTimeMs }
      );
      return data;
    },
    [getDbCacheScope, staleTimeMs]
  );

  const getOwnerDepartmentsCached = useCallback(
    async (limit = 500) => {
      const safeLimit = Number(limit || 500);
      const cacheKey = buildCacheKey('owners-departments', getDbCacheScope(), safeLimit);
      const { data } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getOwnerDepartments(limit),
        { staleTimeMs }
      );
      return data;
    },
    [getDbCacheScope, staleTimeMs]
  );

  const getLocationsCached = useCallback(
    async (branchNo) => {
      const safeBranchNo = String(branchNo ?? '').trim();
      const cacheKey = buildCacheKey('locations-priority', getDbCacheScope(), safeBranchNo);
      const { data } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getLocations(branchNo),
        { staleTimeMs }
      );
      return data;
    },
    [getDbCacheScope, staleTimeMs]
  );

  const getModelsCached = useCallback(
    async (typeNo, ciType = 1) => {
      const safeTypeNo = Number(typeNo || 0);
      const safeCiType = Number(ciType || 1);
      const cacheKey = buildCacheKey('models-by-type', getDbCacheScope(), safeTypeNo, safeCiType);
      const { data } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getModels(typeNo, safeCiType),
        { staleTimeMs }
      );
      return data;
    },
    [getDbCacheScope, staleTimeMs]
  );

  return {
    getDbCacheScope,
    searchOwnersCached,
    getOwnerDepartmentsCached,
    getLocationsCached,
    getModelsCached,
  };
}

export default useDatabaseLookups;

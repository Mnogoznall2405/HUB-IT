import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import {
  DATA_MODE_CONSUMABLES,
} from './equipmentModel';
import {
  countGroupedItems,
  filterGroupedByBranch,
  mergeGroupedEquipment,
} from './databaseListModel';
import { normalizeDatabaseText, normalizeGroupedDatabaseData } from './textEncoding';

export const DATABASE_EQUIPMENT_PAGE_LIMIT = 1000;
export const DATABASE_EQUIPMENT_PREFETCH_PAGES = 1;
export const DATABASE_SWR_STALE_TIME_MS = 30_000;

export function useDatabaseEquipmentData({
  dataMode,
  selectedBranch,
  getDbCacheScope,
  staleTimeMs = DATABASE_SWR_STALE_TIME_MS,
  pageLimit = DATABASE_EQUIPMENT_PAGE_LIMIT,
  prefetchPages = DATABASE_EQUIPMENT_PREFETCH_PAGES,
}) {
  const initialLoadStartedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [branches, setBranches] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [equipment, setEquipment] = useState({});
  const [allEquipment, setAllEquipment] = useState({});
  const [total, setTotal] = useState(0);
  const [serverTotal, setServerTotal] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [nextEquipmentPage, setNextEquipmentPage] = useState(null);
  const [equipmentPagesTotal, setEquipmentPagesTotal] = useState(1);
  const [loadingMoreEquipment, setLoadingMoreEquipment] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const fetchEquipmentTypes = useCallback(async ({ force = false } = {}) => {
    try {
      const cacheKey = buildCacheKey('equipment-types', getDbCacheScope());
      const { data: response } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getTypes(),
        { staleTimeMs, force }
      );
      const normalized = (Array.isArray(response) ? response : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        return {
          ...item,
          type_name: normalizeDatabaseText(item.type_name),
          TYPE_NAME: normalizeDatabaseText(item.TYPE_NAME),
        };
      });
      setEquipmentTypes(normalized);
    } catch (error) {
      console.error('Error fetching types:', error);
    }
  }, [getDbCacheScope, staleTimeMs]);

  const fetchStatuses = useCallback(async ({ force = false } = {}) => {
    try {
      const cacheKey = buildCacheKey('equipment-statuses', getDbCacheScope());
      const { data: response } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getStatuses(),
        { staleTimeMs, force }
      );
      const normalized = (Array.isArray(response) ? response : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        return {
          ...item,
          status_name: normalizeDatabaseText(item.status_name),
          STATUS_NAME: normalizeDatabaseText(item.STATUS_NAME),
        };
      });
      setStatuses(normalized);
    } catch (error) {
      console.error('Error fetching statuses:', error);
    }
  }, [getDbCacheScope, staleTimeMs]);

  const fetchBranches = useCallback(async ({ force = false } = {}) => {
    try {
      const cacheKey = buildCacheKey('equipment-branches-list', getDbCacheScope());
      const { data } = await getOrFetchSWR(
        cacheKey,
        () => equipmentAPI.getBranchesList(),
        { staleTimeMs, force }
      );
      const normalized = (Array.isArray(data) ? data : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        return {
          ...item,
          branch_name: normalizeDatabaseText(item.branch_name),
          BRANCH_NAME: normalizeDatabaseText(item.BRANCH_NAME),
        };
      });
      setBranches(normalized);
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  }, [getDbCacheScope, staleTimeMs]);

  const fetchEquipmentGroupedPage = useCallback(async (page, { force = false } = {}) => {
    const safePage = Math.max(1, Number(page || 1));
    const groupedCacheKey = dataMode === DATA_MODE_CONSUMABLES ? 'consumables-grouped' : 'equipment-grouped';
    const cacheKey = buildCacheKey(
      groupedCacheKey,
      getDbCacheScope(),
      safePage,
      pageLimit
    );
    const { data } = await getOrFetchSWR(
      cacheKey,
      () => (
        dataMode === DATA_MODE_CONSUMABLES
          ? equipmentAPI.getAllConsumablesGrouped({ page: safePage, limit: pageLimit })
          : equipmentAPI.getAllEquipmentGrouped({ page: safePage, limit: pageLimit })
      ),
      { staleTimeMs, force }
    );
    return {
      ...(data || {}),
      grouped: normalizeGroupedDatabaseData(data?.grouped || {}),
    };
  }, [dataMode, getDbCacheScope, pageLimit, staleTimeMs]);

  const loadMoreEquipmentPages = useCallback(({
    startPage = null,
    maxPages = 1,
    force = false,
    totalPagesOverride = null,
  } = {}) => {
    const resolvedTotalPages = Number(totalPagesOverride || equipmentPagesTotal || 1);
    const initialPage = startPage ?? nextEquipmentPage;
    if (!initialPage || initialPage > resolvedTotalPages || loadingMoreEquipment) return undefined;

    setLoadingMoreEquipment(true);
    return (async () => {
      let cursor = initialPage;
      let loadedPagesInRun = 0;
      let mergedChunk = {};
      let latestServerTotal = serverTotal;

      while (cursor <= resolvedTotalPages && loadedPagesInRun < Math.max(1, maxPages)) {
        const pageResult = await fetchEquipmentGroupedPage(cursor, { force });
        mergedChunk = mergeGroupedEquipment(mergedChunk, pageResult.grouped || {});
        latestServerTotal = Number(pageResult.total || latestServerTotal || 0);
        cursor += 1;
        loadedPagesInRun += 1;
      }

      if (loadedPagesInRun > 0) {
        setAllEquipment((prev) => {
          const nextGrouped = mergeGroupedEquipment(prev, mergedChunk);
          setLoadedCount(countGroupedItems(nextGrouped));
          return nextGrouped;
        });
      }

      setServerTotal(latestServerTotal || 0);
      setNextEquipmentPage(cursor <= resolvedTotalPages ? cursor : null);
    })().catch((error) => {
      console.error('Error loading additional equipment pages:', error);
    }).finally(() => {
      setLoadingMoreEquipment(false);
    });
  }, [
    nextEquipmentPage,
    equipmentPagesTotal,
    loadingMoreEquipment,
    serverTotal,
    fetchEquipmentGroupedPage,
  ]);

  const fetchAllEquipment = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    try {
      const firstPageResult = await fetchEquipmentGroupedPage(1, { force });
      const firstGrouped = firstPageResult.grouped || {};
      const firstLoadedCount = countGroupedItems(firstGrouped);
      const totalFromServer = Number(firstPageResult.total || firstLoadedCount || 0);
      const pagesFromServer = Math.max(
        1,
        Number(firstPageResult.pages || Math.ceil((totalFromServer || 0) / pageLimit) || 1)
      );

      setAllEquipment(firstGrouped);
      setEquipment(firstGrouped);
      setLoadedCount(firstLoadedCount);
      setTotal(firstLoadedCount);
      setServerTotal(totalFromServer || firstLoadedCount);
      setEquipmentPagesTotal(pagesFromServer);
      setNextEquipmentPage(pagesFromServer > 1 ? 2 : null);
      setInitialLoadDone(true);

      if (pagesFromServer > 1 && prefetchPages > 0) {
        void loadMoreEquipmentPages({
          startPage: 2,
          maxPages: prefetchPages,
          force,
          totalPagesOverride: pagesFromServer,
        });
      }
    } catch (error) {
      console.error('Error fetching equipment:', error);
    } finally {
      setLoading(false);
    }
  }, [fetchEquipmentGroupedPage, loadMoreEquipmentPages, pageLimit, prefetchPages]);

  const refreshCurrentDbData = useCallback(async ({ force = false } = {}) => {
    await Promise.all([
      fetchEquipmentTypes({ force }),
      fetchStatuses({ force }),
      fetchBranches({ force }),
    ]);
    await fetchAllEquipment({ force });
  }, [fetchEquipmentTypes, fetchStatuses, fetchBranches, fetchAllEquipment]);

  const resetEquipmentData = useCallback(() => {
    setInitialLoadDone(false);
    setEquipment({});
    setAllEquipment({});
    setTotal(0);
    setServerTotal(0);
    setLoadedCount(0);
    setEquipmentPagesTotal(1);
    setNextEquipmentPage(null);
  }, []);

  useEffect(() => {
    if (!initialLoadDone) return;

    const filtered = filterGroupedByBranch(allEquipment, selectedBranch);
    setEquipment(filtered);
    setTotal(countGroupedItems(filtered));
  }, [selectedBranch, allEquipment, initialLoadDone]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void refreshCurrentDbData();
  }, [refreshCurrentDbData]);

  return {
    loading,
    equipmentTypes,
    branches,
    statuses,
    equipment,
    allEquipment,
    total,
    serverTotal,
    loadedCount,
    nextEquipmentPage,
    equipmentPagesTotal,
    loadingMoreEquipment,
    initialLoadDone,
    setAllEquipment,
    setLoadedCount,
    setServerTotal,
    setTotal,
    loadMoreEquipmentPages,
    fetchAllEquipment,
    refreshCurrentDbData,
    resetEquipmentData,
  };
}

export default useDatabaseEquipmentData;

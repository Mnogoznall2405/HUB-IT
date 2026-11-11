import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentAPI } from '../../api/client';

export const DATABASE_RECENT_ACTS_LIMIT = 8;

const normalizeItems = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
};

const normalizeDocNo = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) && asNumber > 0 ? String(asNumber) : raw;
};

const upsertRecentAct = (items, nextItem) => {
  const docNo = normalizeDocNo(nextItem?.doc_no ?? nextItem?.DOC_NO);
  if (!docNo) return items;
  const filtered = items.filter((item) => normalizeDocNo(item?.doc_no ?? item?.DOC_NO) !== docNo);
  return [nextItem, ...filtered].slice(0, DATABASE_RECENT_ACTS_LIMIT);
};

export function useDatabaseRecentActs({
  enabled = true,
  dbName = '',
  limit = DATABASE_RECENT_ACTS_LIMIT,
} = {}) {
  const [recentActs, setRecentActs] = useState([]);
  const [recentActsLoading, setRecentActsLoading] = useState(false);
  const hasWarmCacheRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    hasWarmCacheRef.current = false;
    setRecentActs([]);
  }, [dbName]);

  const refreshRecentActs = useCallback(async () => {
    if (!enabled) {
      setRecentActsLoading(false);
      return [];
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!hasWarmCacheRef.current) {
      setRecentActsLoading(true);
    }
    try {
      const payload = await equipmentAPI.getRecentActs({ limit });
      if (requestIdRef.current !== requestId) return [];
      const items = normalizeItems(payload);
      setRecentActs(items);
      hasWarmCacheRef.current = true;
      return items;
    } catch (error) {
      console.warn('Failed to load recent equipment acts', error);
      if (requestIdRef.current !== requestId) return [];
      if (!hasWarmCacheRef.current) {
        setRecentActs([]);
      }
      return [];
    } finally {
      if (requestIdRef.current === requestId) {
        setRecentActsLoading(false);
      }
    }
  }, [enabled, limit]);

  const touchRecentAct = useCallback(async ({
    docNo,
    docNumber = '',
    actionType = 'view',
    snapshot = null,
  } = {}) => {
    const normalizedDocNo = normalizeDocNo(
      docNo ?? snapshot?.doc_no ?? snapshot?.DOC_NO,
    );
    if (!enabled || !normalizedDocNo) return null;

    try {
      const item = await equipmentAPI.touchRecentAct({
        docNo: Number(normalizedDocNo),
        docNumber: String(docNumber || snapshot?.doc_number || snapshot?.DOC_NUMBER || '').trim(),
        actionType,
        snapshot,
      });
      setRecentActs((prev) => upsertRecentAct(prev, item));
      hasWarmCacheRef.current = true;
      return item;
    } catch (error) {
      console.warn('Failed to record recent equipment act activity', error);
      return null;
    }
  }, [enabled]);

  const removeRecentAct = useCallback(async (docNo) => {
    const normalizedDocNo = normalizeDocNo(docNo);
    if (!normalizedDocNo) return null;

    setRecentActs((prev) => (
      prev.filter((item) => normalizeDocNo(item?.doc_no ?? item?.DOC_NO) !== normalizedDocNo)
    ));
    try {
      return await equipmentAPI.removeRecentAct(normalizedDocNo);
    } catch (error) {
      console.warn('Failed to remove recent equipment act', error);
      return null;
    }
  }, []);

  const clearRecentActs = useCallback(async () => {
    setRecentActs([]);
    hasWarmCacheRef.current = true;
    try {
      return await equipmentAPI.clearRecentActs();
    } catch (error) {
      console.warn('Failed to clear recent equipment acts', error);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRecentActsLoading(false);
      return undefined;
    }
    void refreshRecentActs();
    return undefined;
  }, [dbName, enabled, refreshRecentActs]);

  return {
    recentActs,
    recentActsLoading,
    refreshRecentActs,
    touchRecentAct,
    removeRecentAct,
    clearRecentActs,
  };
}

export default useDatabaseRecentActs;

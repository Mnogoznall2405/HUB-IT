import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanAPI } from '../api/client';

export const INCIDENT_BATCH_SIZE = 500;

function compactFilters(filters) {
  const out = {};
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (value === 'all') return;
    out[key] = value;
  });
  return out;
}

export function useScanIncidentInbox(filters, options = {}) {
  const batchSize = Number(options.batchSize || INCIDENT_BATCH_SIZE);
  const normalizedFilters = useMemo(() => compactFilters(filters), [filters]);
  const filtersKey = useMemo(() => JSON.stringify(normalizedFilters), [normalizedFilters]);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const cancelInFlight = useCallback(() => {
    requestIdRef.current += 1;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    cancelInFlight();
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    if (!silent) setLoadingInitial(true);
    setLoadingMore(false);
    setError(null);

    try {
      const first = await scanAPI.getIncidents(
        { ...normalizedFilters, limit: batchSize, offset: 0 },
        { signal: controller.signal },
      );
      if (requestId !== requestIdRef.current) return;
      const firstItems = Array.isArray(first?.items) ? first.items : [];
      const nextTotal = Number(first?.total || firstItems.length || 0);
      setItems(firstItems);
      setTotal(nextTotal);
      setLoaded(firstItems.length);
      if (!silent) setLoadingInitial(false);

      let nextOffset = first?.next_offset ?? firstItems.length;
      let hasMore = Boolean(first?.has_more);
      if (!hasMore && nextOffset < nextTotal) hasMore = true;
      setLoadingMore(hasMore);

      while (hasMore && nextOffset < nextTotal) {
        const page = await scanAPI.getIncidents(
          { ...normalizedFilters, limit: batchSize, offset: nextOffset },
          { signal: controller.signal },
        );
        if (requestId !== requestIdRef.current) return;
        const pageItems = Array.isArray(page?.items) ? page.items : [];
        setItems((prev) => [...prev, ...pageItems]);
        nextOffset = page?.next_offset ?? (nextOffset + pageItems.length);
        hasMore = Boolean(page?.has_more);
        if (!hasMore && nextOffset < nextTotal && pageItems.length > 0) hasMore = true;
        if (pageItems.length === 0) hasMore = false;
        setLoaded(Math.min(nextOffset, nextTotal));
      }
    } catch (nextError) {
      if (nextError?.name === 'CanceledError' || nextError?.name === 'AbortError' || nextError?.code === 'ERR_CANCELED') return;
      if (requestId === requestIdRef.current) {
        setError(nextError);
        if (!silent) setItems([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingInitial(false);
        setLoadingMore(false);
      }
    }
  }, [batchSize, cancelInFlight, normalizedFilters]);

  const refreshFirstPage = useCallback(async ({ silent = true } = {}) => {
    const requestId = requestIdRef.current;
    if (!silent) setLoadingInitial(true);
    setError(null);
    try {
      const first = await scanAPI.getIncidents({ ...normalizedFilters, limit: batchSize, offset: 0 });
      if (requestId !== requestIdRef.current) return;
      const firstItems = Array.isArray(first?.items) ? first.items : [];
      const nextTotal = Number(first?.total || firstItems.length || 0);
      setTotal(nextTotal);
      setItems((prev) => {
        const tail = prev.slice(firstItems.length);
        const merged = [...firstItems, ...tail];
        return merged.slice(0, Math.max(merged.length, firstItems.length));
      });
      setLoaded((prev) => Math.max(firstItems.length, Math.min(prev, nextTotal)));
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(nextError);
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoadingInitial(false);
    }
  }, [batchSize, normalizedFilters]);

  useEffect(() => {
    loadAll({ silent: false });
    return () => cancelInFlight();
  }, [filtersKey, loadAll, cancelInFlight]);

  return {
    filters: normalizedFilters,
    filtersKey,
    items,
    total,
    loaded,
    loadingInitial,
    loadingMore,
    error,
    reload: loadAll,
    refreshFirstPage,
    cancel: cancelInFlight,
  };
}

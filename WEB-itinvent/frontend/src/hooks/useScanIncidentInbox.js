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

  const loadFirstPage = useCallback(async ({ silent = false } = {}) => {
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

  const loadMore = useCallback(async () => {
    if (loadingInitial || loadingMore) return;
    if (loaded >= total) return;
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await scanAPI.getIncidents(
        { ...normalizedFilters, limit: batchSize, offset: loaded },
        { signal: controller.signal },
      );
      if (requestId !== requestIdRef.current) return;
      const pageItems = Array.isArray(page?.items) ? page.items : [];
      const nextOffset = page?.next_offset ?? (loaded + pageItems.length);
      const nextTotal = Number(page?.total || total || pageItems.length || 0);
      setItems((prev) => [...prev, ...pageItems]);
      setTotal(nextTotal);
      setLoaded(Math.min(nextOffset, nextTotal));
    } catch (nextError) {
      if (nextError?.name === 'CanceledError' || nextError?.name === 'AbortError' || nextError?.code === 'ERR_CANCELED') return;
      if (requestId === requestIdRef.current) setError(nextError);
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [batchSize, loaded, loadingInitial, loadingMore, normalizedFilters, total]);

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
        // Keep any already-loaded pages beyond page 1 (avoid collapsing the list
        // on a silent refresh), but drop tail entries that are now duplicated in
        // the freshly-fetched first page (e.g. re-ordered into it, or already acked).
        const freshIds = new Set(firstItems.map((item) => String(item?.id ?? '')));
        const tail = prev.slice(firstItems.length).filter((item) => !freshIds.has(String(item?.id ?? '')));
        return [...firstItems, ...tail];
      });
      setLoaded((prev) => Math.max(firstItems.length, Math.min(prev, nextTotal)));
    } catch (nextError) {
      if (requestId === requestIdRef.current) setError(nextError);
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoadingInitial(false);
    }
  }, [batchSize, normalizedFilters]);

  useEffect(() => {
    loadFirstPage({ silent: false });
    return () => cancelInFlight();
  }, [filtersKey, loadFirstPage, cancelInFlight]);

  return {
    filters: normalizedFilters,
    filtersKey,
    items,
    total,
    loaded,
    loadingInitial,
    loadingMore,
    error,
    hasMore: loaded < total,
    reload: loadFirstPage,
    loadMore,
    refreshFirstPage,
    cancel: cancelInFlight,
  };
}

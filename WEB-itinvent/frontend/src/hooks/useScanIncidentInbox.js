import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const INCIDENT_BATCH_SIZE = 80;

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
  const enabled = options.enabled !== false;
  const getIncidentsRef = useRef(options.getIncidents);
  getIncidentsRef.current = options.getIncidents;

  const normalizedFilters = useMemo(() => compactFilters(filters), [filters]);
  const filtersKey = useMemo(() => JSON.stringify(normalizedFilters), [normalizedFilters]);
  const normalizedFiltersRef = useRef(normalizedFilters);
  normalizedFiltersRef.current = normalizedFilters;

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
    if (!enabled) {
      cancelInFlight();
      setItems([]);
      setTotal(0);
      setLoaded(0);
      setLoadingInitial(false);
      setLoadingMore(false);
      setError(null);
      return;
    }
    cancelInFlight();
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    if (!silent) setLoadingInitial(true);
    setLoadingMore(false);
    setError(null);

    try {
      const fn = getIncidentsRef.current;
      const first = typeof fn === 'function'
        ? await fn(
          { ...normalizedFiltersRef.current, limit: batchSize, offset: 0 },
          { signal: controller.signal },
        )
        : { items: [], total: 0 };
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
  }, [batchSize, cancelInFlight, enabled]);

  const loadMore = useCallback(async () => {
    if (loadingInitial || loadingMore) return;
    if (loaded >= total) return;
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const fn = getIncidentsRef.current;
      const page = typeof fn === 'function'
        ? await fn(
          { ...normalizedFiltersRef.current, limit: batchSize, offset: loaded },
          { signal: controller.signal },
        )
        : { items: [] };
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
  }, [batchSize, loaded, loadingInitial, loadingMore, total]);

  const refreshFirstPage = useCallback(async ({ silent = true } = {}) => {
    if (!enabled) return;
    const requestId = requestIdRef.current;
    if (!silent) setLoadingInitial(true);
    setError(null);
    try {
      const fn = getIncidentsRef.current;
      const first = typeof fn === 'function'
        ? await fn({ ...normalizedFiltersRef.current, limit: batchSize, offset: 0 })
        : { items: [], total: 0 };
      if (requestId !== requestIdRef.current) return;
      const firstItems = Array.isArray(first?.items) ? first.items : [];
      const nextTotal = Number(first?.total || firstItems.length || 0);
      setTotal(nextTotal);
      setItems((prev) => {
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
  }, [batchSize, enabled]);

  useEffect(() => {
    loadFirstPage({ silent: false });
    return () => cancelInFlight();
  }, [filtersKey, enabled, loadFirstPage, cancelInFlight]);

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

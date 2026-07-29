import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentTransferActsAPI } from '../../api/equipmentTransferActs';

const DEFAULT_DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 2;
const LATEST_ACTS_LIMIT = 50;

export function useDatabaseActSearch({
  searchQuery,
  searchScope,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}) {
  const [actResults, setActResults] = useState([]);
  const [actSearchLoading, setActSearchLoading] = useState(false);
  const [actSearchError, setActSearchError] = useState('');
  const [actSearchTruncated, setActSearchTruncated] = useState(false);
  const [actFeedMode, setActFeedMode] = useState('latest'); // 'latest' | 'search'
  const debounceTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const warmLatestRef = useRef([]);

  const applyPayload = useCallback((payload, mode) => {
    setActResults(Array.isArray(payload?.acts) ? payload.acts : []);
    setActSearchTruncated(Boolean(payload?.truncated));
    setActFeedMode(mode);
    if (mode === 'latest') {
      warmLatestRef.current = Array.isArray(payload?.acts) ? payload.acts : [];
    }
  }, []);

  const resetActSearch = useCallback(() => {
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    requestIdRef.current += 1;
    setActResults([]);
    setActSearchLoading(false);
    setActSearchError('');
    setActSearchTruncated(false);
    setActFeedMode('latest');
  }, []);

  const loadLatestActs = useCallback(async ({ force = false } = {}) => {
    if (!enabled || searchScope !== 'acts') {
      return;
    }

    if (!force && warmLatestRef.current.length > 0) {
      setActResults(warmLatestRef.current);
      setActFeedMode('latest');
      setActSearchError('');
      setActSearchLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setActSearchLoading(true);
    setActSearchError('');

    try {
      const payload = await equipmentTransferActsAPI.getLatestActs({ limit: LATEST_ACTS_LIMIT });
      if (requestId !== requestIdRef.current) return;
      applyPayload(payload, 'latest');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const detail = error?.response?.data?.detail;
      setActSearchError(typeof detail === 'string' ? detail : 'Не удалось загрузить список актов');
      setActResults([]);
      setActSearchTruncated(false);
      setActFeedMode('latest');
    } finally {
      if (requestId === requestIdRef.current) {
        setActSearchLoading(false);
      }
    }
  }, [applyPayload, enabled, searchScope]);

  const runActSearchNow = useCallback(async (query) => {
    const normalized = String(query || '').trim();
    if (!enabled || searchScope !== 'acts') {
      resetActSearch();
      return;
    }
    if (normalized.length < MIN_QUERY_LENGTH) {
      await loadLatestActs();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setActSearchLoading(true);
    setActSearchError('');

    try {
      const payload = await equipmentTransferActsAPI.searchActs(normalized);
      if (requestId !== requestIdRef.current) return;
      applyPayload(payload, 'search');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const detail = error?.response?.data?.detail;
      setActSearchError(typeof detail === 'string' ? detail : 'Не удалось выполнить поиск по актам');
      setActResults([]);
      setActSearchTruncated(false);
      setActFeedMode('search');
    } finally {
      if (requestId === requestIdRef.current) {
        setActSearchLoading(false);
      }
    }
  }, [applyPayload, enabled, loadLatestActs, resetActSearch, searchScope]);

  useEffect(() => {
    if (!enabled || searchScope !== 'acts') {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return undefined;
    }

    const normalized = String(searchQuery || '').trim();
    if (normalized.length < MIN_QUERY_LENGTH) {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      void loadLatestActs();
      return undefined;
    }

    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void runActSearchNow(normalized);
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [debounceMs, enabled, loadLatestActs, runActSearchNow, searchQuery, searchScope]);

  // Prefetch latest acts while still on equipment scope so Acts tab opens instantly.
  useEffect(() => {
    if (!enabled || searchScope === 'acts') return undefined;
    if (warmLatestRef.current.length > 0) return undefined;

    let active = true;
    const prefetch = async () => {
      try {
        const payload = await equipmentTransferActsAPI.getLatestActs({ limit: LATEST_ACTS_LIMIT });
        if (!active) return;
        warmLatestRef.current = Array.isArray(payload?.acts) ? payload.acts : [];
      } catch {
        // Prefetch is best-effort; Acts tab will retry on open.
      }
    };
    void prefetch();
    return () => {
      active = false;
    };
  }, [enabled, searchScope]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    if (debounceTimerRef.current != null) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  const clearActSearchError = useCallback(() => {
    setActSearchError('');
  }, []);

  return {
    actResults,
    actSearchLoading,
    actSearchError,
    actSearchTruncated,
    actFeedMode,
    resetActSearch,
    runActSearchNow,
    loadLatestActs,
    clearActSearchError,
  };
}

export default useDatabaseActSearch;

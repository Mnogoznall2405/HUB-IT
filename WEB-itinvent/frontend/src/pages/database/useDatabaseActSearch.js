import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentTransferActsAPI } from '../../api/equipmentTransferActs';

const DEFAULT_DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 2;

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
  const debounceTimerRef = useRef(null);
  const requestIdRef = useRef(0);

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
  }, []);

  const runActSearchNow = useCallback(async (query) => {
    const normalized = String(query || '').trim();
    if (!enabled || searchScope !== 'acts') {
      resetActSearch();
      return;
    }
    if (normalized.length < MIN_QUERY_LENGTH) {
      resetActSearch();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setActSearchLoading(true);
    setActSearchError('');

    try {
      const payload = await equipmentTransferActsAPI.searchActs(normalized);
      if (requestId !== requestIdRef.current) return;
      setActResults(Array.isArray(payload?.acts) ? payload.acts : []);
      setActSearchTruncated(Boolean(payload?.truncated));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const detail = error?.response?.data?.detail;
      setActSearchError(typeof detail === 'string' ? detail : 'Не удалось выполнить поиск по актам');
      setActResults([]);
      setActSearchTruncated(false);
    } finally {
      if (requestId === requestIdRef.current) {
        setActSearchLoading(false);
      }
    }
  }, [enabled, resetActSearch, searchScope]);

  useEffect(() => {
    if (!enabled || searchScope !== 'acts') {
      resetActSearch();
      return undefined;
    }

    const normalized = String(searchQuery || '').trim();
    if (normalized.length < MIN_QUERY_LENGTH) {
      resetActSearch();
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
  }, [debounceMs, enabled, resetActSearch, runActSearchNow, searchQuery, searchScope]);

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
    resetActSearch,
    runActSearchNow,
    clearActSearchError,
  };
}

export default useDatabaseActSearch;

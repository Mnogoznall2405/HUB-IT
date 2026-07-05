import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hubTaskSupportAPI from '../api/hubTaskSupport';

export const TASK_ASSIGNEE_SEARCH_MIN_CHARS = 2;
export const TASK_ASSIGNEE_SEARCH_LIMIT = 30;

export function mergeTaskAssigneeOptions(...groups) {
  const byId = new Map();
  groups
    .flat()
    .filter(Boolean)
    .forEach((user) => {
      const id = String(user?.id || '').trim();
      if (id) byId.set(id, user);
    });
  return [...byId.values()];
}

export default function useTaskAssigneeDirectory({ departmentId = '' } = {}) {
  const [cache, setCache] = useState(() => new Map());
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchRequestRef = useRef(0);
  const resolveRequestRef = useRef(0);

  const mergeIntoCache = useCallback((users) => {
    const items = Array.isArray(users) ? users : [];
    if (!items.length) return;
    setCache((prev) => {
      const next = new Map(prev);
      items.forEach((user) => {
        const id = String(user?.id || '').trim();
        if (id) next.set(id, user);
      });
      return next;
    });
  }, []);

  const getById = useCallback((id) => {
    const normalized = String(id || '').trim();
    return normalized ? (cache.get(normalized) || null) : null;
  }, [cache]);

  const getPickerOptions = useCallback((...selectedGroups) => (
    mergeTaskAssigneeOptions(...selectedGroups, searchResults)
  ), [searchResults]);

  const search = useCallback(async (query, options = {}) => {
    const normalizedQuery = String(query || '').trim();
    const quiet = Boolean(options.quiet);
    if (normalizedQuery.length < TASK_ASSIGNEE_SEARCH_MIN_CHARS) {
      if (!quiet) {
        setSearchResults([]);
        setError('');
      }
      return [];
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    if (!quiet) {
      setLoading(true);
      setError('');
    }

    try {
      const params = {
        q: normalizedQuery,
        limit: TASK_ASSIGNEE_SEARCH_LIMIT,
      };
      const normalizedDepartmentId = String(options.departmentId ?? departmentId ?? '').trim();
      if (normalizedDepartmentId) {
        params.department_id = normalizedDepartmentId;
      }
      const payload = await hubTaskSupportAPI.getAssignees(params);
      if (searchRequestRef.current !== requestId) return [];
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (!quiet) {
        setSearchResults(items);
      }
      mergeIntoCache(items);
      return items;
    } catch (requestError) {
      if (searchRequestRef.current !== requestId) return [];
      const message = String(
        requestError?.response?.data?.detail
        || requestError?.message
        || 'Не удалось найти исполнителей',
      );
      if (!quiet) {
        setError(message);
        setSearchResults([]);
      }
      throw requestError;
    } finally {
      if (!quiet && searchRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [departmentId, mergeIntoCache]);

  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const resolveByIds = useCallback(async (ids, options = {}) => {
    const normalizedIds = [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    )];
    if (!normalizedIds.length) return [];

    const missingIds = normalizedIds.filter((id) => !cacheRef.current.has(id));
    if (!missingIds.length) {
      return normalizedIds.map((id) => cacheRef.current.get(id)).filter(Boolean);
    }

    const requestId = resolveRequestRef.current + 1;
    resolveRequestRef.current = requestId;

    try {
      const params = { ids: missingIds.join(',') };
      const normalizedDepartmentId = String(options.departmentId ?? departmentId ?? '').trim();
      if (normalizedDepartmentId) {
        params.department_id = normalizedDepartmentId;
      }
      const payload = await hubTaskSupportAPI.getAssignees(params);
      if (resolveRequestRef.current !== requestId) return [];
      const items = Array.isArray(payload?.items) ? payload.items : [];
      mergeIntoCache(items);
      return normalizedIds.map((id) => (
        items.find((item) => String(item?.id || '') === id) || cacheRef.current.get(id)
      )).filter(Boolean);
    } catch {
      return normalizedIds.map((id) => cacheRef.current.get(id)).filter(Boolean);
    }
  }, [departmentId, mergeIntoCache]);

  const clearSearchResults = useCallback(() => {
    setSearchResults([]);
    setError('');
  }, []);

  useEffect(() => {
    setSearchResults([]);
    setError('');
  }, [departmentId]);

  const cacheValues = useMemo(() => [...cache.values()], [cache]);

  return {
    cacheValues,
    searchResults,
    loading,
    error,
    search,
    resolveByIds,
    getById,
    getPickerOptions,
    clearSearchResults,
    mergeIntoCache,
  };
}

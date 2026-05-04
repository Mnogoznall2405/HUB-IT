import { useCallback, useEffect, useState } from 'react';

export const MAIL_RECENT_SEARCHES_KEY = 'mail_recent_searches_v1';

export const DEFAULT_ADVANCED_FILTERS = {
  q: '',
  from_filter: '',
  to_filter: '',
  subject_filter: '',
  body_filter: '',
  importance: '',
  folder_scope: 'current',
};

export function buildRecentSearchEntry(filters = {}) {
  const nextEntry = {
    ...DEFAULT_ADVANCED_FILTERS,
    ...(filters || {}),
  };
  const labelParts = [];
  if (nextEntry.q) labelParts.push(nextEntry.q);
  if (nextEntry.from_filter) labelParts.push(`от:${nextEntry.from_filter}`);
  if (nextEntry.to_filter) labelParts.push(`кому:${nextEntry.to_filter}`);
  if (nextEntry.subject_filter) labelParts.push(`тема:${nextEntry.subject_filter}`);
  if (nextEntry.importance) labelParts.push(`важность:${nextEntry.importance}`);
  return {
    ...nextEntry,
    label: labelParts.join(' • ') || 'Фильтр',
  };
}

export function hasAdvancedSearchFilters(filters = {}) {
  const nextFilters = {
    ...DEFAULT_ADVANCED_FILTERS,
    ...(filters || {}),
  };
  return Boolean(
    nextFilters.q
    || nextFilters.from_filter
    || nextFilters.to_filter
    || nextFilters.subject_filter
    || nextFilters.body_filter
    || nextFilters.importance
    || (nextFilters.folder_scope && nextFilters.folder_scope !== 'current')
  );
}

function persistRecentSearches(nextSearches, storageKey) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(nextSearches));
  } catch {
    // ignore local storage issues
  }
}

export default function useMailAdvancedSearch({
  initialFilters = DEFAULT_ADVANCED_FILTERS,
  storageKey = MAIL_RECENT_SEARCHES_KEY,
  onSearchChange,
} = {}) {
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState({
    ...DEFAULT_ADVANCED_FILTERS,
    ...(initialFilters || {}),
  });
  const [advancedFiltersApplied, setAdvancedFiltersApplied] = useState({
    ...DEFAULT_ADVANCED_FILTERS,
    ...(initialFilters || {}),
  });
  const [recentSearches, setRecentSearches] = useState([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setRecentSearches(Array.isArray(parsed) ? parsed : []);
    } catch {
      setRecentSearches([]);
    }
  }, [storageKey]);

  const rememberRecentSearch = useCallback((filters) => {
    const payload = buildRecentSearchEntry(filters);
    setRecentSearches((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const deduped = current.filter((item) => (
        JSON.stringify({ ...item, label: undefined }) !== JSON.stringify({ ...payload, label: undefined })
      ));
      const next = [payload, ...deduped].slice(0, 8);
      persistRecentSearches(next, storageKey);
      return next;
    });
  }, [storageKey]);

  const handleApplyAdvancedSearch = useCallback(() => {
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(advancedFiltersDraft || {}) };
    setAdvancedFiltersApplied(nextFilters);
    onSearchChange?.(String(nextFilters.q || ''));
    if (hasAdvancedSearchFilters(nextFilters)) {
      rememberRecentSearch(nextFilters);
    }
    setAdvancedSearchOpen(false);
  }, [advancedFiltersDraft, onSearchChange, rememberRecentSearch]);

  const handleResetAdvancedSearch = useCallback(() => {
    setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
    setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
    onSearchChange?.('');
  }, [onSearchChange]);

  const handleApplyRecentSearch = useCallback((item) => {
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(item || {}) };
    setAdvancedFiltersDraft(nextFilters);
    setAdvancedFiltersApplied(nextFilters);
    onSearchChange?.(String(nextFilters.q || ''));
    setAdvancedSearchOpen(false);
  }, [onSearchChange]);

  return {
    advancedSearchOpen,
    setAdvancedSearchOpen,
    advancedFiltersDraft,
    setAdvancedFiltersDraft,
    advancedFiltersApplied,
    setAdvancedFiltersApplied,
    recentSearches,
    rememberRecentSearch,
    handleApplyAdvancedSearch,
    handleResetAdvancedSearch,
    handleApplyRecentSearch,
  };
}

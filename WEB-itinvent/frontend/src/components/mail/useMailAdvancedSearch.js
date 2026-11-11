import { useCallback, useEffect, useRef, useState } from 'react';
import { BROWSER_ACCOUNT_EVENT, getStoredUserKey } from '../../lib/browserAccountSession';

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
  userKey = getStoredUserKey(),
  onSearchChange,
} = {}) {
  const owner = String(userKey ?? '');
  const scopedStorageKey = owner ? `${storageKey}:${encodeURIComponent(owner)}` : '';
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const [epoch, setEpoch] = useState(0);
  const scope = JSON.stringify([scopedStorageKey, epoch]);
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;

  const createState = useCallback((filters = DEFAULT_ADVANCED_FILTERS) => {
    let recentSearches = [];
    try {
      const raw = scopedStorageKey && getStoredUserKey() === owner
        ? window.localStorage.getItem(scopedStorageKey) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      recentSearches = Array.isArray(parsed) ? parsed : [];
    } catch {
      // Unavailable storage must not prevent searching.
    }
    return {
      scope,
      advancedSearchOpen: false,
      advancedFiltersDraft: { ...DEFAULT_ADVANCED_FILTERS, ...(filters || {}) },
      advancedFiltersApplied: { ...DEFAULT_ADVANCED_FILTERS, ...(filters || {}) },
      recentSearches,
    };
  }, [owner, scope, scopedStorageKey]);
  const [state, setState] = useState(() => createState(initialFilters));
  const ownsScope = useCallback(() => (
    mountedRef.current && activeScopeRef.current === scope && epochRef.current === epoch && getStoredUserKey() === owner
  ), [epoch, owner, scope]);
  // A changed account must not expose old state even during the first render,
  // before effects hydrate the new scope.
  const currentState = state.scope === scope && ownsScope() ? state : createState();
  const { advancedFiltersDraft } = currentState;

  useEffect(() => {
    mountedRef.current = true;
    const accountChanged = (event) => {
      if (!event.detail?.reset) return;
      epochRef.current += 1;
      setEpoch(epochRef.current);
    };
    window.addEventListener(BROWSER_ACCOUNT_EVENT, accountChanged);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(BROWSER_ACCOUNT_EVENT, accountChanged);
    };
  }, []);

  useEffect(() => {
    setState((previous) => previous.scope === scope ? previous : createState());
  }, [createState, scope]);

  const updateState = useCallback((update) => {
    if (!ownsScope()) return;
    setState((previous) => {
      if (!ownsScope()) return previous;
      return update(previous.scope === scope ? previous : createState());
    });
  }, [createState, ownsScope, scope]);

  const setAdvancedSearchOpen = useCallback((value) => updateState((previous) => ({
    ...previous, advancedSearchOpen: typeof value === 'function' ? value(previous.advancedSearchOpen) : value,
  })), [updateState]);
  const setAdvancedFiltersDraft = useCallback((value) => updateState((previous) => ({
    ...previous, advancedFiltersDraft: typeof value === 'function' ? value(previous.advancedFiltersDraft) : value,
  })), [updateState]);
  const setAdvancedFiltersApplied = useCallback((value) => updateState((previous) => ({
    ...previous, advancedFiltersApplied: typeof value === 'function' ? value(previous.advancedFiltersApplied) : value,
  })), [updateState]);

  const rememberRecentSearch = useCallback((filters) => {
    const payload = buildRecentSearchEntry(filters);
    updateState((previous) => {
      const current = previous.recentSearches;
      const deduped = current.filter((item) => (
        JSON.stringify({ ...item, label: undefined }) !== JSON.stringify({ ...payload, label: undefined })
      ));
      const next = [payload, ...deduped].slice(0, 8);
      if (scopedStorageKey) persistRecentSearches(next, scopedStorageKey);
      return { ...previous, recentSearches: next };
    });
  }, [scopedStorageKey, updateState]);

  const handleApplyAdvancedSearch = useCallback(() => {
    if (!ownsScope()) return;
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(advancedFiltersDraft || {}) };
    setAdvancedFiltersApplied(nextFilters);
    onSearchChange?.(String(nextFilters.q || ''));
    if (hasAdvancedSearchFilters(nextFilters)) {
      rememberRecentSearch(nextFilters);
    }
    setAdvancedSearchOpen(false);
  }, [advancedFiltersDraft, onSearchChange, ownsScope, rememberRecentSearch, setAdvancedFiltersApplied, setAdvancedSearchOpen]);

  const handleResetAdvancedSearch = useCallback(() => {
    if (!ownsScope()) return;
    setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
    setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
    onSearchChange?.('');
  }, [onSearchChange, ownsScope, setAdvancedFiltersApplied, setAdvancedFiltersDraft]);

  const handleApplyRecentSearch = useCallback((item) => {
    if (!ownsScope()) return;
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(item || {}) };
    setAdvancedFiltersDraft(nextFilters);
    setAdvancedFiltersApplied(nextFilters);
    onSearchChange?.(String(nextFilters.q || ''));
    setAdvancedSearchOpen(false);
  }, [onSearchChange, ownsScope, setAdvancedFiltersApplied, setAdvancedFiltersDraft, setAdvancedSearchOpen]);

  return {
    advancedSearchOpen: currentState.advancedSearchOpen,
    setAdvancedSearchOpen,
    advancedFiltersDraft,
    setAdvancedFiltersDraft,
    advancedFiltersApplied: currentState.advancedFiltersApplied,
    setAdvancedFiltersApplied,
    recentSearches: currentState.recentSearches,
    rememberRecentSearch,
    handleApplyAdvancedSearch,
    handleResetAdvancedSearch,
    handleApplyRecentSearch,
  };
}

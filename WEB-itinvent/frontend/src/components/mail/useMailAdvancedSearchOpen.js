import { useCallback } from 'react';

export function buildMailAdvancedSearchDraft({ advancedFiltersApplied, search } = {}) {
  return {
    ...(advancedFiltersApplied || {}),
    q: search,
  };
}

export default function useMailAdvancedSearchOpen({
  advancedFiltersApplied,
  search,
  setAdvancedFiltersDraft,
  setAdvancedSearchOpen,
} = {}) {
  return useCallback(() => {
    setAdvancedFiltersDraft(buildMailAdvancedSearchDraft({
      advancedFiltersApplied,
      search,
    }));
    setAdvancedSearchOpen(true);
  }, [advancedFiltersApplied, search, setAdvancedFiltersDraft, setAdvancedSearchOpen]);
}

import { useEffect } from 'react';

import { writeStoredMailViewState } from './mailViewStateModel';

export default function useMailViewStatePersistence({
  activeMailboxId,
  folder,
  viewMode,
  search,
  unreadOnly,
  hasAttachmentsOnly,
  filterDateFrom,
  filterDateTo,
  advancedFiltersApplied,
  defaultAdvancedFilters,
  persistViewState = writeStoredMailViewState,
} = {}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    persistViewState({
      folder,
      viewMode,
      search,
      unreadOnly,
      hasAttachmentsOnly,
      filterDateFrom,
      filterDateTo,
      advancedFiltersApplied,
    }, {
      mailboxId: activeMailboxId,
      defaultAdvancedFilters,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    search,
    unreadOnly,
    viewMode,
  ]);
}

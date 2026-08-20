import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_ADVANCED_FILTERS } from './useMailAdvancedSearch';
import useMailViewStatePersistence from './useMailViewStatePersistence';

describe('useMailViewStatePersistence', () => {
  it('writes the current view state for the active mailbox', () => {
    const persistViewState = vi.fn();
    const advancedFiltersApplied = { ...DEFAULT_ADVANCED_FILTERS, from_filter: 'a@b.c' };

    renderHook(() => useMailViewStatePersistence({
      activeMailboxId: 'mb-1',
      folder: 'sent',
      viewMode: 'conversations',
      search: 'invoice',
      unreadOnly: true,
      hasAttachmentsOnly: false,
      filterDateFrom: '2026-08-01',
      filterDateTo: '2026-08-20',
      advancedFiltersApplied,
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
      persistViewState,
    }));

    expect(persistViewState).toHaveBeenCalledWith({
      folder: 'sent',
      viewMode: 'conversations',
      search: 'invoice',
      unreadOnly: true,
      hasAttachmentsOnly: false,
      filterDateFrom: '2026-08-01',
      filterDateTo: '2026-08-20',
      advancedFiltersApplied,
    }, {
      mailboxId: 'mb-1',
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
    });
  });
});

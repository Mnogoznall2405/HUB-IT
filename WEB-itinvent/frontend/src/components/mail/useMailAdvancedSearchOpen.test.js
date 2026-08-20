import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailAdvancedSearchOpen, { buildMailAdvancedSearchDraft } from './useMailAdvancedSearchOpen';

describe('useMailAdvancedSearchOpen', () => {
  it('copies applied filters and the current search query into the dialog draft', () => {
    expect(buildMailAdvancedSearchDraft({
      advancedFiltersApplied: { from: 'a@b.c', unread: true },
      search: 'invoice',
    })).toEqual({
      from: 'a@b.c',
      unread: true,
      q: 'invoice',
    });
    expect(buildMailAdvancedSearchDraft({ search: '' })).toEqual({ q: '' });
    expect(buildMailAdvancedSearchDraft()).toEqual({ q: undefined });
  });

  it('opens the advanced search dialog with that draft', () => {
    const setAdvancedFiltersDraft = vi.fn();
    const setAdvancedSearchOpen = vi.fn();
    const { result } = renderHook(() => useMailAdvancedSearchOpen({
      advancedFiltersApplied: { has_attachments: true },
      search: 'act',
      setAdvancedFiltersDraft,
      setAdvancedSearchOpen,
    }));

    result.current();

    expect(setAdvancedFiltersDraft).toHaveBeenCalledWith({
      has_attachments: true,
      q: 'act',
    });
    expect(setAdvancedSearchOpen).toHaveBeenCalledWith(true);
  });
});

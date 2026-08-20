import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailViewRefreshAction from './useMailViewRefreshAction';

describe('useMailViewRefreshAction', () => {
  it('invalidates the client cache and force-refreshes list, summary and tree', () => {
    const calls = [];
    const invalidateMailClientCache = vi.fn(() => calls.push('invalidate'));
    const refreshList = vi.fn(() => calls.push('list'));
    const refreshFolderSummary = vi.fn(() => calls.push('summary'));
    const refreshFolderTree = vi.fn(() => calls.push('tree'));

    const { result } = renderHook(() => useMailViewRefreshAction({
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
      refreshFolderTree,
    }));

    result.current();

    expect(invalidateMailClientCache).toHaveBeenCalledTimes(1);
    expect(refreshList).toHaveBeenCalledWith({ force: true });
    expect(refreshFolderSummary).toHaveBeenCalledTimes(1);
    expect(refreshFolderTree).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['invalidate', 'list', 'summary', 'tree']);
  });
});

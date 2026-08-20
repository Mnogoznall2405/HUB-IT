import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailLastSyncedAt from './useMailLastSyncedAt';

describe('useMailLastSyncedAt', () => {
  it('stamps the first painted list as synced', () => {
    const setMailLastSyncedAt = vi.fn();
    renderHook(() => useMailLastSyncedAt({
      mailBackgroundRefreshing: false,
      loading: false,
      listItems: [],
      mailLastSyncedAt: null,
      setMailLastSyncedAt,
    }));
    expect(setMailLastSyncedAt).toHaveBeenCalledTimes(1);
  });

  it('stamps when a background refresh finishes', () => {
    const setMailLastSyncedAt = vi.fn();
    const { rerender } = renderHook(
      ({ mailBackgroundRefreshing }) => useMailLastSyncedAt({
        mailBackgroundRefreshing,
        loading: true,
        listItems: undefined,
        mailLastSyncedAt: 1,
        setMailLastSyncedAt,
      }),
      { initialProps: { mailBackgroundRefreshing: true } },
    );
    expect(setMailLastSyncedAt).not.toHaveBeenCalled();
    rerender({ mailBackgroundRefreshing: false });
    expect(setMailLastSyncedAt).toHaveBeenCalledTimes(1);
  });
});

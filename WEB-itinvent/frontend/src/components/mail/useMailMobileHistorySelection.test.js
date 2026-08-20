import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailMobileHistorySelection from './useMailMobileHistorySelection';

describe('useMailMobileHistorySelection', () => {
  it('restores selection and switches view mode when needed', () => {
    const restoreMobileHistorySelection = vi.fn();
    const setViewMode = vi.fn();
    const { result } = renderHook(() => useMailMobileHistorySelection({
      viewModeRef: { current: 'messages' },
      setViewMode,
      restoreMobileHistorySelection,
    }));

    result.current(null);
    result.current({ selectedId: '' });
    expect(restoreMobileHistorySelection).not.toHaveBeenCalled();

    const nextState = { selectedId: 'msg-2', selectionMode: 'conversations' };
    result.current(nextState);

    expect(setViewMode).toHaveBeenCalledWith('conversations');
    expect(restoreMobileHistorySelection).toHaveBeenCalledWith(nextState);
  });
});

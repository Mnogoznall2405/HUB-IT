import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailComposeGatedSelection from './useMailComposeGatedSelection';

describe('useMailComposeGatedSelection', () => {
  it('selects immediately when compose is closed', () => {
    const selectMailListItem = vi.fn();
    const selectAdjacentMessageRaw = vi.fn();
    const { result } = renderHook(() => useMailComposeGatedSelection({
      composeOpen: false,
      requestCloseComposeThen: vi.fn(),
      selectMailListItem,
      selectAdjacentMessageRaw,
    }));

    result.current.handleSelectMailListItem('msg-1', { id: 'msg-1' });
    result.current.selectAdjacentMessage(1);

    expect(selectMailListItem).toHaveBeenCalledWith('msg-1', { id: 'msg-1' });
    expect(selectAdjacentMessageRaw).toHaveBeenCalledWith(1);
  });

  it('closes compose first and then runs the pending selection', () => {
    const selectMailListItem = vi.fn();
    const selectAdjacentMessageRaw = vi.fn();
    const requestCloseComposeThen = vi.fn((afterClose) => afterClose());
    const { result } = renderHook(() => useMailComposeGatedSelection({
      composeOpen: true,
      requestCloseComposeThen,
      selectMailListItem,
      selectAdjacentMessageRaw,
    }));

    result.current.handleSelectMailListItem('msg-2', { id: 'msg-2' });
    result.current.selectAdjacentMessage(-1);

    expect(requestCloseComposeThen).toHaveBeenCalledTimes(2);
    expect(selectMailListItem).toHaveBeenCalledWith('msg-2', { id: 'msg-2' });
    expect(selectAdjacentMessageRaw).toHaveBeenCalledWith(-1);
  });
});

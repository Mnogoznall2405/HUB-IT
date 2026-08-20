import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailSelectedByModeSync from './useMailSelectedByModeSync';

describe('useMailSelectedByModeSync', () => {
  it('stores the current selection for the active view mode', () => {
    const setSelectedByMode = vi.fn();
    renderHook(() => useMailSelectedByModeSync({
      selectedId: 'msg-9',
      viewMode: 'messages',
      setSelectedByMode,
    }));
    const updater = setSelectedByMode.mock.calls[0][0];
    expect(updater({ conversations: 'c-1' })).toEqual({
      conversations: 'c-1',
      messages: 'msg-9',
    });
  });

  it('keeps the previous map when the value is unchanged', () => {
    const setSelectedByMode = vi.fn();
    renderHook(() => useMailSelectedByModeSync({
      selectedId: 'msg-9',
      viewMode: 'messages',
      setSelectedByMode,
    }));
    const updater = setSelectedByMode.mock.calls[0][0];
    const prev = { messages: 'msg-9' };
    expect(updater(prev)).toBe(prev);
  });
});

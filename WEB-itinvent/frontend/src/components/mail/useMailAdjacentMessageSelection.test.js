import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailAdjacentMessageSelection from './useMailAdjacentMessageSelection';

describe('useMailAdjacentMessageSelection', () => {
  it('moves selection in messages view and paints a preview shell', () => {
    const selectedIdRef = { current: 'msg-1' };
    const setSelectedId = vi.fn();
    const setSelectedByMode = vi.fn((updater) => updater({ conversations: 'conv-1' }));
    const setSelectedConversation = vi.fn();
    const setSelectedMessage = vi.fn();
    const listData = {
      items: [
        { id: 'msg-1', subject: 'First', folder: 'inbox' },
        { id: 'msg-2', subject: 'Second', folder: 'inbox' },
      ],
    };

    const { result } = renderHook(() => useMailAdjacentMessageSelection({
      listData,
      selectedId: 'msg-1',
      selectedIdRef,
      setSelectedId,
      setSelectedByMode,
      setSelectedConversation,
      setSelectedMessage,
      viewMode: 'messages',
      folder: 'inbox',
    }));

    result.current(1);

    expect(selectedIdRef.current).toBe('msg-2');
    expect(setSelectedId).toHaveBeenCalledWith('msg-2');
    expect(setSelectedByMode).toHaveBeenCalledTimes(1);
    expect(setSelectedConversation).toHaveBeenCalledWith(null);
    expect(setSelectedMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-2',
      subject: 'Second',
      __previewOnly: true,
    }));
  });

  it('does not paint a message preview shell in conversations view', () => {
    const setSelectedMessage = vi.fn();
    const setSelectedConversation = vi.fn();
    const { result } = renderHook(() => useMailAdjacentMessageSelection({
      listData: { items: [{ id: 'conv-1' }, { id: 'conv-2' }] },
      selectedId: 'conv-1',
      selectedIdRef: { current: 'conv-1' },
      setSelectedId: vi.fn(),
      setSelectedByMode: vi.fn(),
      setSelectedConversation,
      setSelectedMessage,
      viewMode: 'conversations',
      folder: 'inbox',
    }));

    result.current(1);

    expect(setSelectedConversation).not.toHaveBeenCalled();
    expect(setSelectedMessage).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailSelectedDetailState from './useMailSelectedDetailState';

describe('useMailSelectedDetailState', () => {
  it('clears selected detail state and aborts the active detail request', () => {
    const abort = vi.fn();
    const setMoveTarget = vi.fn();
    const queueListScrollRestore = vi.fn();
    const { result } = renderHook(() => useMailSelectedDetailState({
      viewMode: 'messages',
      setMoveTarget,
      queueListScrollRestore,
    }));

    act(() => {
      result.current.detailRequestAbortRef.current = { abort };
      result.current.setSelectedId('msg-1');
      result.current.setSelectedByMode({ messages: 'msg-1', conversations: 'conv-1' });
      result.current.setSelectedMessage({ id: 'msg-1' });
      result.current.setSelectedConversation({ conversation_id: 'conv-1' });
      result.current.setDetailLoading(true);
      result.current.detailContextRef.current = 'messages:inbox:msg-1';
    });

    act(() => {
      result.current.clearSelection({ restoreListState: true });
    });

    expect(abort).toHaveBeenCalledTimes(1);
    expect(result.current.detailRequestAbortRef.current).toBeNull();
    expect(result.current.selectedId).toBe('');
    expect(result.current.selectedMessage).toBeNull();
    expect(result.current.selectedConversation).toBeNull();
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.detailContextRef.current).toBe('');
    expect(result.current.selectedByMode).toEqual({ messages: '', conversations: 'conv-1' });
    expect(setMoveTarget).toHaveBeenCalledWith('');
    expect(queueListScrollRestore).toHaveBeenCalledTimes(1);
  });

  it('clears all remembered modes only when requested', () => {
    const { result } = renderHook(() => useMailSelectedDetailState());

    act(() => {
      result.current.setSelectedByMode({ messages: 'msg-1', conversations: 'conv-1' });
      result.current.clearSelection({ mode: 'conversations', allModes: true });
    });

    expect(result.current.selectedByMode).toEqual({ messages: '', conversations: '' });
  });

  it('restores mobile history selection and clears bulk selection', () => {
    const setSelectedItems = vi.fn();
    const { result } = renderHook(() => useMailSelectedDetailState({ setSelectedItems }));

    act(() => {
      result.current.restoreMobileHistorySelection({
        selectionMode: 'conversations',
        selectedId: 'conv-2',
      });
    });

    expect(setSelectedItems).toHaveBeenCalledWith([]);
    expect(result.current.selectedId).toBe('conv-2');
    expect(result.current.selectedIdRef.current).toBe('conv-2');
    expect(result.current.selectedByMode).toEqual({ messages: '', conversations: 'conv-2' });
  });
});

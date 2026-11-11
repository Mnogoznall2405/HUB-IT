import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailConversationSelectionGuard from './useMailConversationSelectionGuard';

describe('useMailConversationSelectionGuard', () => {
  it('clears a conversation that is no longer in the list', () => {
    const clearSelection = vi.fn();
    renderHook(() => useMailConversationSelectionGuard({
      viewMode: 'conversations',
      selectedId: 'c-gone',
      listItems: [{ conversation_id: 'c-1' }, { id: 'c-2' }],
      clearSelection,
    }));
    expect(clearSelection).toHaveBeenCalledWith({ mode: 'conversations' });
  });

  it('keeps the selection in messages view or when the id is still present', () => {
    const clearSelection = vi.fn();
    renderHook(() => useMailConversationSelectionGuard({
      viewMode: 'messages',
      selectedId: 'c-gone',
      listItems: [{ conversation_id: 'c-1' }],
      clearSelection,
    }));
    renderHook(() => useMailConversationSelectionGuard({
      viewMode: 'conversations',
      selectedId: 'c-1',
      listItems: [{ conversation_id: 'c-1' }],
      clearSelection,
    }));
    expect(clearSelection).not.toHaveBeenCalled();
  });
});

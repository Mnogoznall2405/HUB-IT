import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatDraftsAndPinned from './useChatDraftsAndPinned';

describe('useChatDraftsAndPinned', () => {
  it('returns draft and pinned storage keys for active conversation', () => {
    const suppressDraftSyncRef = { current: false };
    const draftWriteTimeoutRef = { current: null };
    const latestDraftStorageKeyRef = { current: '' };
    const latestMessageTextRef = { current: '' };

    const { result } = renderHook(() => useChatDraftsAndPinned({
      userId: 42,
      activeConversationId: 'conv-1',
      messageText: 'draft text',
      pinnedMessage: null,
      setPinnedMessage: vi.fn(),
      suppressDraftSyncRef,
      draftWriteTimeoutRef,
      latestDraftStorageKeyRef,
      latestMessageTextRef,
    }));

    expect(result.current.draftStorageKey).toContain('42');
    expect(result.current.draftStorageKey).toContain('conv-1');
    expect(typeof result.current.flushDraftToStorage).toBe('function');
    expect(typeof result.current.persistPinnedMessage).toBe('function');
  });
});

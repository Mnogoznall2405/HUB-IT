import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHAT_DRAFT_TTL_MS } from '../../lib/chatDraftsStorage';
import useChatDraftsAndPinned from './useChatDraftsAndPinned';

afterEach(() => {
  window.localStorage.clear();
});

const buildHookProps = (overrides = {}) => ({
  userId: 42,
  activeConversationId: 'conv-1',
  messageText: 'draft text',
  pinnedMessage: null,
  setPinnedMessage: vi.fn(),
  suppressDraftSyncRef: { current: false },
  draftWriteTimeoutRef: { current: null },
  latestDraftStorageKeyRef: { current: '' },
  latestMessageTextRef: { current: '' },
  ...overrides,
});

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

  it('sweeps expired drafts on mount', () => {
    window.localStorage.setItem('chat:draft:42:stale', 'старый черновик');
    window.localStorage.setItem('chat:draft-meta', JSON.stringify({
      'chat:draft:42:stale': Date.now() - CHAT_DRAFT_TTL_MS - 1_000,
    }));

    renderHook(() => useChatDraftsAndPinned(buildHookProps()));

    expect(window.localStorage.getItem('chat:draft:42:stale')).toBeNull();
  });

  it('tracks flushed drafts in the meta index and drops cleared ones', () => {
    const { result } = renderHook(() => useChatDraftsAndPinned(buildHookProps()));

    act(() => {
      result.current.flushDraftToStorage('chat:draft:42:conv-9', 'текст');
    });
    let meta = JSON.parse(window.localStorage.getItem('chat:draft-meta'));
    expect(meta['chat:draft:42:conv-9']).toBeGreaterThan(0);
    expect(window.localStorage.getItem('chat:draft:42:conv-9')).toBe('текст');

    act(() => {
      result.current.flushDraftToStorage('chat:draft:42:conv-9', '');
    });
    expect(window.localStorage.getItem('chat:draft:42:conv-9')).toBeNull();
    meta = JSON.parse(window.localStorage.getItem('chat:draft-meta') || '{}');
    expect(meta['chat:draft:42:conv-9']).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  isPendingShareDraftForConversation,
  normalizeConversationId,
  resolveDraftRestoreMessageText,
  scheduleDraftSyncResume,
} from './useChatConversationDraftRestore';
import useChatConversationDraftRestore from './useChatConversationDraftRestore';

describe('useChatConversationDraftRestore helpers', () => {
  it('normalizeConversationId trims conversation ids', () => {
    expect(normalizeConversationId('  c1  ')).toBe('c1');
    expect(normalizeConversationId(null)).toBe('');
  });

  it('isPendingShareDraftForConversation matches normalized ids', () => {
    expect(isPendingShareDraftForConversation(null, 'c1')).toBe(false);
    expect(isPendingShareDraftForConversation({ conversationId: ' c1 ' }, 'c1')).toBe(true);
    expect(isPendingShareDraftForConversation({ conversationId: 'c2' }, 'c1')).toBe(false);
  });

  it('resolveDraftRestoreMessageText returns empty text without storage key', () => {
    expect(resolveDraftRestoreMessageText({
      draftStorageKey: '',
      activeConversationId: 'c1',
      pendingShareDraft: { conversationId: 'c1', bodyText: 'share' },
    })).toEqual({
      messageText: '',
      clearPendingShareDraft: false,
      persistToStorage: false,
    });
  });

  it('resolveDraftRestoreMessageText prefers pending share draft for active conversation', () => {
    expect(resolveDraftRestoreMessageText({
      draftStorageKey: 'draft:c1',
      activeConversationId: 'c1',
      pendingShareDraft: { conversationId: ' c1 ', bodyText: ' shared ' },
      readLocalStorageItem: vi.fn(() => 'stored'),
    })).toEqual({
      messageText: ' shared ',
      clearPendingShareDraft: true,
      persistToStorage: true,
      storageKey: 'draft:c1',
      storageValue: ' shared ',
    });
  });

  it('resolveDraftRestoreMessageText reads localStorage when share draft does not match', () => {
    const readLocalStorageItem = vi.fn(() => 'stored draft');
    expect(resolveDraftRestoreMessageText({
      draftStorageKey: 'draft:c1',
      activeConversationId: 'c1',
      pendingShareDraft: { conversationId: 'c2', bodyText: 'share' },
      readLocalStorageItem,
    })).toEqual({
      messageText: 'stored draft',
      clearPendingShareDraft: false,
      persistToStorage: false,
    });
    expect(readLocalStorageItem).toHaveBeenCalledWith('draft:c1');
  });

  it('resolveDraftRestoreMessageText falls back to empty text on storage read failure', () => {
    expect(resolveDraftRestoreMessageText({
      draftStorageKey: 'draft:c1',
      activeConversationId: 'c1',
      pendingShareDraft: null,
      readLocalStorageItem: () => {
        throw new Error('blocked');
      },
    })).toEqual({
      messageText: '',
      clearPendingShareDraft: false,
      persistToStorage: false,
    });
  });

  it('scheduleDraftSyncResume clears scheduled timeout', () => {
    const callback = vi.fn();
    const setTimeoutFn = vi.fn((cb) => {
      cb();
      return 42;
    });
    const clearTimeoutFn = vi.fn();
    const cleanup = scheduleDraftSyncResume(callback, { setTimeoutFn, clearTimeoutFn });
    expect(setTimeoutFn).toHaveBeenCalledWith(callback, 0);
    expect(callback).toHaveBeenCalledTimes(1);
    cleanup();
    expect(clearTimeoutFn).toHaveBeenCalledWith(42);
  });
});

describe('useChatConversationDraftRestore', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatConversationDraftRestore).toBe('function');
  });

  it('restores draft and resumes sync on conversation change', async () => {
    const { renderHook } = await import('@testing-library/react');
    const suppressDraftSyncRef = { current: false };
    const shareComposeDraftRef = { current: null };
    const latestMessageTextRef = { current: '' };
    const setReplyMessage = vi.fn();
    const setEditingMessage = vi.fn();
    const setMessageText = vi.fn();
    const readLocalStorageItem = vi.fn(() => 'hello draft');

    const { unmount } = renderHook(() => useChatConversationDraftRestore({
      activeConversationId: 'c1',
      draftStorageKey: 'draft:c1',
      latestMessageTextRef,
      setEditingMessage,
      setMessageText,
      setReplyMessage,
      shareComposeDraftRef,
      suppressDraftSyncRef,
      readLocalStorageItem,
      writeLocalStorageItem: vi.fn(),
    }));

    expect(suppressDraftSyncRef.current).toBe(true);
    expect(setReplyMessage).toHaveBeenCalledWith(null);
    expect(setEditingMessage).toHaveBeenCalledWith(null);
    expect(setMessageText).toHaveBeenCalledWith('hello draft');
    expect(latestMessageTextRef.current).toBe('');
    expect(readLocalStorageItem).toHaveBeenCalledWith('draft:c1');

    await vi.waitFor(() => {
      expect(suppressDraftSyncRef.current).toBe(false);
    });

    unmount();
  });

  it('does not restore draft again when parent re-renders with same conversation', async () => {
    const { renderHook } = await import('@testing-library/react');
    const suppressDraftSyncRef = { current: false };
    const shareComposeDraftRef = { current: null };
    const latestMessageTextRef = { current: '' };
    const setReplyMessage = vi.fn();
    const setEditingMessage = vi.fn();
    const setMessageText = vi.fn();
    const readLocalStorageItem = vi.fn(() => 'hello draft');

    const { rerender } = renderHook(
      ({ draftStorageKey }) => useChatConversationDraftRestore({
        activeConversationId: 'c1',
        draftStorageKey,
        latestMessageTextRef,
        setEditingMessage,
        setMessageText,
        setReplyMessage,
        shareComposeDraftRef,
        suppressDraftSyncRef,
        readLocalStorageItem,
        writeLocalStorageItem: vi.fn(),
      }),
      { initialProps: { draftStorageKey: 'draft:c1' } },
    );

    expect(setMessageText).toHaveBeenCalledWith('hello draft');
    const callsAfterMount = setMessageText.mock.calls.length;

    rerender({ draftStorageKey: 'draft:c1' });

    expect(setMessageText.mock.calls.length).toBe(callsAfterMount);
    expect(readLocalStorageItem).toHaveBeenCalledTimes(1);
  });
});

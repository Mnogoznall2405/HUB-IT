import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatAPI } from '../../api/client';
import useChatMessageSearch from '../../components/chat/useChatMessageSearch';
import useChatComposerSending from '../../components/chat/useChatComposerSending';
import useChatThreadMessageMerge from './useChatThreadMessageMerge';

vi.mock('../../api/client', () => ({ chatAPI: { searchMessages: vi.fn(), editChatMessage: vi.fn() } }));
vi.mock('../../lib/chatSocket', () => ({ chatSocket: {} }));
vi.mock('../../lib/debugClientLog', () => ({ emitAgentDebugLog: vi.fn() }));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('chat async state ownership', () => {
  it('keeps current thread marker and scroll when another conversation finishes sending', () => {
    const setViewerLastReadAt = vi.fn();
    const setViewerLastReadMessageId = vi.fn();
    const queueAutoScroll = vi.fn();
    const syncConversationPreview = vi.fn();
    let messages = [];
    const { result } = renderHook(() => useChatThreadMessageMerge({
      activeConversationIdRef: { current: 'B' }, messagesRef: { current: [] },
      setMessages: (update) => { messages = update(messages); },
      isLikelyOptimisticReplacement: vi.fn(), withStableMessageRenderKey: (m) => m,
      setViewerLastReadAt, setViewerLastReadMessageId, queueAutoScroll, syncConversationPreview,
      promoteConversationToTop: vi.fn(),
    }));
    act(() => result.current.applyOutgoingThreadMessage('A', { id: 'a1', conversation_id: 'A', is_own: true }, { scroll: true }));
    expect(messages).toEqual([]);
    expect(setViewerLastReadAt).not.toHaveBeenCalled();
    expect(setViewerLastReadMessageId).not.toHaveBeenCalled();
    expect(queueAutoScroll).not.toHaveBeenCalled();
    expect(syncConversationPreview).toHaveBeenCalledWith('A', expect.any(Object), expect.any(Object));
  });

  it.each(['clear', 'reset', 'close', 'switch'])('ignores pending search after %s', async (action) => {
    vi.useFakeTimers();
    let finish;
    chatAPI.searchMessages.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const activeConversationIdRef = { current: 'A' };
    const args = { activeConversationIdRef, loadChatDialogsModule: vi.fn(), notifyApiError: vi.fn(), setThreadMenuAnchor: vi.fn(), setMessageMenuAnchor: vi.fn(), setMessageMenuMessage: vi.fn() };
    const { result, rerender } = renderHook(({ id }) => useChatMessageSearch({ ...args, activeConversationId: id }), { initialProps: { id: 'A' } });
    act(() => { result.current.openSearchDialog(); result.current.setMessageSearch('disk'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(chatAPI.searchMessages).toHaveBeenCalledTimes(1);
    act(() => {
      if (action === 'clear') result.current.setMessageSearch('');
      if (action === 'reset') result.current.resetMessageSearch();
      if (action === 'close') result.current.closeSearchDialog();
      if (action === 'switch') { activeConversationIdRef.current = 'B'; rerender({ id: 'B' }); }
    });
    await act(async () => { finish({ items: [{ id: 'a1' }], has_more: true }); });
    expect(result.current.messageSearchResults).toEqual([]);
    expect(result.current.messageSearchHasMore).toBe(false);
    expect(result.current.messageSearchLoading).toBe(false);
  });

  it('preserves a new composer draft when an earlier edit fails', async () => {
    let rejectEdit;
    chatAPI.editChatMessage.mockReturnValueOnce(new Promise((_, reject) => { rejectEdit = reject; }));
    const latestMessageTextRef = { current: 'edited text' };
    const setMessageText = vi.fn((text) => { latestMessageTextRef.current = text; });
    const setEditingMessage = vi.fn();
    const { result } = renderHook(() => useChatComposerSending({
      activeConversationId: 'A', activeConversationIdRef: { current: 'A' }, latestMessageTextRef,
      editingMessage: { id: 'a1', body: 'original' }, setMessageText, setEditingMessage,
      focusComposer: vi.fn(), notifyApiError: vi.fn(),
    }));
    let pending;
    act(() => { pending = result.current.sendMessage(); });
    latestMessageTextRef.current = 'next message';
    await act(async () => { rejectEdit(new Error('offline')); await pending; });
    expect(latestMessageTextRef.current).toBe('next message');
    expect(setMessageText).toHaveBeenCalledTimes(1);
    expect(setEditingMessage).toHaveBeenCalledTimes(1);
  });
});

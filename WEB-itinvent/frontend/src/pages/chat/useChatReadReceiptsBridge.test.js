import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatReadReceiptsBridge from './useChatReadReceiptsBridge';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getMessageReads: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

describe('useChatReadReceiptsBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleOptimisticRead syncs unread state for active conversation', () => {
    const syncConversationUnreadState = vi.fn();
    const { result } = renderHook(() => useChatReadReceiptsBridge({
      activeConversationIdRef: { current: 'conv-1' },
      loadChatDialogsModule: vi.fn(),
      loadConversations: vi.fn(),
      loadMessages: vi.fn(),
      notifyApiError: vi.fn(),
      setMessageReadsItems: vi.fn(),
      setMessageReadsLoading: vi.fn(),
      setMessageReadsMessage: vi.fn(),
      setMessageReadsOpen: vi.fn(),
      sidebarSearchActive: false,
      syncConversationUnreadState,
    }));

    act(() => {
      result.current.handleOptimisticRead('msg-9');
    });

    expect(syncConversationUnreadState).toHaveBeenCalledWith('conv-1', 'msg-9');
  });

  it('handleReadReceiptsSyncError revalidates thread and sidebar', () => {
    const loadMessages = vi.fn().mockResolvedValue([]);
    const loadConversations = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useChatReadReceiptsBridge({
      activeConversationIdRef: { current: 'conv-1' },
      loadChatDialogsModule: vi.fn(),
      loadConversations,
      loadMessages,
      notifyApiError: vi.fn(),
      setMessageReadsItems: vi.fn(),
      setMessageReadsLoading: vi.fn(),
      setMessageReadsMessage: vi.fn(),
      setMessageReadsOpen: vi.fn(),
      sidebarSearchActive: false,
      syncConversationUnreadState: vi.fn(),
    }));

    act(() => {
      result.current.handleReadReceiptsSyncError();
    });

    expect(loadMessages).toHaveBeenCalledWith('conv-1', {
      silent: true,
      reason: 'read-receipts:revalidate',
      force: true,
    });
    expect(loadConversations).toHaveBeenCalledWith({ silent: true, force: true });
  });

  it('openMessageReads loads read receipts into dialog state', async () => {
    chatAPI.getMessageReads.mockResolvedValue({ items: [{ user_id: 1 }] });
    const setMessageReadsOpen = vi.fn();
    const setMessageReadsLoading = vi.fn();
    const setMessageReadsItems = vi.fn();
    const setMessageReadsMessage = vi.fn();

    const { result } = renderHook(() => useChatReadReceiptsBridge({
      activeConversationIdRef: { current: 'conv-1' },
      loadChatDialogsModule: vi.fn(),
      loadConversations: vi.fn(),
      loadMessages: vi.fn(),
      notifyApiError: vi.fn(),
      setMessageReadsItems,
      setMessageReadsLoading,
      setMessageReadsMessage,
      setMessageReadsOpen,
      sidebarSearchActive: false,
      syncConversationUnreadState: vi.fn(),
    }));

    await act(async () => {
      await result.current.openMessageReads({ id: 'msg-1' });
    });

    expect(chatAPI.getMessageReads).toHaveBeenCalledWith('msg-1');
    expect(setMessageReadsOpen).toHaveBeenCalledWith(true);
    expect(setMessageReadsItems).toHaveBeenCalledWith([{ user_id: 1 }]);
    expect(setMessageReadsLoading).toHaveBeenCalledWith(false);
  });
});

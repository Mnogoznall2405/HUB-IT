import { useEffect, useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailReadMutations from './useMailReadMutations';
import { getReadStateOverrideKey } from './mailReadStateModel';

const createMailAPI = (overrides = {}) => ({
  markAsRead: vi.fn(async () => ({})),
  markAsUnread: vi.fn(async () => ({})),
  markConversationAsRead: vi.fn(async () => ({})),
  markConversationAsUnread: vi.fn(async () => ({})),
  ...overrides,
});

const renderReadMutationHook = (options = {}) => {
  const mailAPI = options.mailAPI || createMailAPI();
  const props = {
    activeMailboxId: 'mailbox-1',
    advancedFiltersApplied: { folder_scope: 'current' },
    folder: 'inbox',
    getMailErrorDetail: vi.fn((error, fallback) => fallback),
    getRecentMessageDetailSnapshot: vi.fn(() => null),
    handleMailCredentialsRequired: vi.fn(async () => false),
    invalidateMailClientCache: vi.fn(),
    mailAPI,
    persistRecentMessageDetailSnapshot: vi.fn(),
    readStateOverrideTtlMs: 120000,
    refreshFolderSummary: vi.fn(async () => ({})),
    refreshList: vi.fn(async () => ({})),
    setError: vi.fn(),
    settleAutoReadGuard: vi.fn(),
    unreadOnly: false,
    withActiveMailboxPayload: vi.fn((payload) => ({ mailbox_id: 'mailbox-1', ...payload })),
    ...options.props,
  };

  const initialState = {
    listData: {
      items: [
        { id: 'msg-1', is_read: false, conversation_id: 'conv-1', unread_count: 2 },
        { id: 'msg-2', is_read: true, conversation_id: 'conv-2', unread_count: 0 },
      ],
    },
    folderSummary: {
      inbox: { unread: 3 },
      sent: { unread: 1 },
    },
    selectedMessage: { id: 'msg-1', is_read: false, conversation_id: 'conv-1' },
    selectedConversation: {
      conversation_id: 'conv-1',
      unread_count: 2,
      messages_count: 3,
      items: [
        { id: 'msg-1', is_read: false },
        { id: 'msg-3', is_read: false },
      ],
    },
    ...(options.initialState || {}),
  };

  const rendered = renderHook(() => {
    const [listData, setListData] = useState(initialState.listData);
    const [folderSummary, setFolderSummary] = useState(initialState.folderSummary);
    const [selectedMessage, setSelectedMessage] = useState(initialState.selectedMessage);
    const [selectedConversation, setSelectedConversation] = useState(initialState.selectedConversation);
    const listDataRef = useRef(listData);
    const selectedMessageRef = useRef(selectedMessage);
    const selectedConversationRef = useRef(selectedConversation);
    const localReadStateOverridesRef = useRef(new Map());
    const folderSummaryRef = useRef(folderSummary);

    useEffect(() => {
      folderSummaryRef.current = folderSummary;
    }, [folderSummary]);

    const hook = useMailReadMutations({
      ...props,
      refs: {
        listDataRef,
        selectedMessageRef,
        selectedConversationRef,
        localReadStateOverridesRef,
        folderSummaryRef,
      },
      setFolderSummary,
      setListData,
      setSelectedConversation,
      setSelectedMessage,
    });

    return {
      ...hook,
      listData,
      folderSummary,
      selectedMessage,
      selectedConversation,
      setFolderSummary,
      refs: {
        listDataRef,
        selectedMessageRef,
        selectedConversationRef,
        localReadStateOverridesRef,
        folderSummaryRef,
      },
    };
  });

  return {
    ...rendered,
    props,
    mailAPI,
  };
};

describe('useMailReadMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically marks a message read, updates unread state, and runs unread-only refresh', async () => {
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
    const { result, props, mailAPI } = renderReadMutationHook({
      props: {
        unreadOnly: true,
        getRecentMessageDetailSnapshot: vi.fn(() => ({ id: 'msg-1', is_read: false, body_text: 'cached' })),
      },
    });

    let mutationResult;
    await act(async () => {
      mutationResult = await result.current.performMailReadMutation({
        mode: 'messages',
        targetId: 'msg-1',
        nextIsRead: true,
        currentUnreadCount: 1,
        currentMessageCount: 1,
        errorMessage: 'Не удалось изменить статус письма.',
        autoReadGuardKey: 'messages:inbox:msg-1:auto-read',
      });
    });

    expect(mutationResult).toBe(true);
    expect(result.current.listData.items[0]).toEqual(expect.objectContaining({ id: 'msg-1', is_read: true }));
    expect(result.current.selectedMessage).toEqual(expect.objectContaining({ id: 'msg-1', is_read: true }));
    expect(result.current.refs.selectedMessageRef.current).toEqual(expect.objectContaining({ id: 'msg-1', is_read: true }));
    expect(result.current.folderSummary.inbox.unread).toBe(2);
    expect(result.current.refs.localReadStateOverridesRef.current.get('messages:msg-1')).toEqual(expect.objectContaining({ isRead: true }));
    expect(mailAPI.markAsRead).toHaveBeenCalledWith('msg-1', 'mailbox-1');
    expect(props.persistRecentMessageDetailSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1', is_read: true }));
    expect(props.invalidateMailClientCache).toHaveBeenCalledWith(['bootstrap', 'list', 'notification-feed']);
    expect(props.refreshList).toHaveBeenCalledWith({
      silent: true,
      selectFirstIfSelectionMissing: true,
      force: true,
    });
    expect(dispatchEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'mail-read',
      detail: expect.objectContaining({
        phase: 'optimistic',
        mode: 'messages',
        targetId: 'msg-1',
        unreadDelta: -1,
        nextIsRead: true,
      }),
    }));
    expect(dispatchEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'mail-read',
      detail: expect.objectContaining({
        phase: 'confirmed',
        mode: 'messages',
        targetId: 'msg-1',
        unreadDelta: 0,
      }),
    }));
    expect(props.settleAutoReadGuard).toHaveBeenCalledWith('messages:inbox:msg-1:auto-read', true);

    dispatchEvent.mockRestore();
  });

  it('reapplies the unread delta when folder summary arrives during the Exchange mutation', async () => {
    let resolveMarkRead;
    const markReadPromise = new Promise((resolve) => {
      resolveMarkRead = resolve;
    });
    const mailAPI = createMailAPI({
      markAsRead: vi.fn(() => markReadPromise),
    });
    const { result } = renderReadMutationHook({
      mailAPI,
      initialState: { folderSummary: {} },
    });

    let pendingMutation;
    act(() => {
      pendingMutation = result.current.performMailReadMutation({
        mode: 'messages',
        targetId: 'msg-1',
        nextIsRead: true,
        currentUnreadCount: 1,
        currentMessageCount: 1,
      });
    });

    act(() => {
      result.current.setFolderSummary({ inbox: { total: 1, unread: 1 } });
    });
    await act(async () => {
      resolveMarkRead({ ok: true });
      await pendingMutation;
    });

    expect(result.current.folderSummary.inbox.unread).toBe(0);
  });

  it('applies conversation read state locally including list unread_count and selected detail items', () => {
    const { result } = renderReadMutationHook();

    act(() => {
      result.current.applyConversationReadStateLocally({
        conversationId: 'conv-1',
        isRead: true,
        unreadCount: 2,
        messageCount: 3,
        unreadDelta: -2,
      });
    });

    expect(result.current.listData.items[0]).toEqual(expect.objectContaining({ conversation_id: 'conv-1', unread_count: 0 }));
    expect(result.current.selectedConversation).toEqual(expect.objectContaining({
      conversation_id: 'conv-1',
      unread_count: 0,
    }));
    expect(result.current.selectedConversation.items).toEqual([
      expect.objectContaining({ id: 'msg-1', is_read: true }),
      expect.objectContaining({ id: 'msg-3', is_read: true }),
    ]);
    expect(result.current.selectedMessage).toEqual(expect.objectContaining({ id: 'msg-1', is_read: true }));
    expect(result.current.refs.selectedConversationRef.current).toEqual(expect.objectContaining({ conversation_id: 'conv-1', unread_count: 0 }));
    expect(result.current.folderSummary.inbox.unread).toBe(1);
  });

  it('clears optimistic overrides and delegates credentials errors on mutation failure', async () => {
    const requestError = new Error('auth required');
    const mailAPI = createMailAPI({
      markAsUnread: vi.fn(async () => {
        throw requestError;
      }),
    });
    const { result, props } = renderReadMutationHook({
      mailAPI,
      props: {
        handleMailCredentialsRequired: vi.fn(async () => true),
      },
      initialState: {
        selectedMessage: { id: 'msg-2', is_read: true },
      },
    });

    let mutationResult;
    await act(async () => {
      mutationResult = await result.current.performMailReadMutation({
        mode: 'messages',
        targetId: 'msg-2',
        nextIsRead: false,
        currentUnreadCount: 0,
        currentMessageCount: 1,
        errorMessage: 'Не удалось изменить статус письма.',
        autoReadGuardKey: 'manual-read-toggle',
      });
    });

    const overrideKey = getReadStateOverrideKey({ mode: 'messages', targetId: 'msg-2' });
    expect(mutationResult).toBe(false);
    expect(result.current.refs.localReadStateOverridesRef.current.has(overrideKey)).toBe(false);
    expect(props.refreshList).toHaveBeenCalledWith({ silent: true, force: true });
    expect(props.refreshFolderSummary).toHaveBeenCalledWith({ force: true });
    expect(props.handleMailCredentialsRequired).toHaveBeenCalledWith(requestError, 'Не удалось изменить статус письма.');
    expect(props.setError).not.toHaveBeenCalled();
    expect(props.settleAutoReadGuard).toHaveBeenCalledWith('manual-read-toggle', false);
  });
});

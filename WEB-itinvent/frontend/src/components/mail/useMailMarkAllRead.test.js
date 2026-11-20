import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailMarkAllRead from './useMailMarkAllRead';

const createDeps = (overrides = {}) => ({
  mailAPI: {
    markAllRead: vi.fn(async () => ({ changed: 4 })),
  },
  activeMailboxId: 'mailbox-1',
  folder: 'inbox',
  folderScope: 'current',
  viewMode: 'messages',
  selectedConversation: null,
  selectedMessage: { id: 'msg-1', is_read: false, conversation_id: 'conv-1' },
  applyConversationReadStateLocally: vi.fn(),
  applyMessageReadStateLocally: vi.fn(),
  afterListMutation: vi.fn(async () => undefined),
  notifyMailSuccess: vi.fn(),
  handleMailCredentialsRequired: vi.fn(async () => false),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  setError: vi.fn(),
  ...overrides,
});

describe('useMailMarkAllRead', () => {
  it('marks the folder read and updates an unread selected message locally', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.markAllRead).toHaveBeenCalledWith({
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      folder_scope: 'current',
    });
    expect(deps.applyMessageReadStateLocally).toHaveBeenCalledWith({
      messageId: 'msg-1',
      isRead: true,
      unreadDelta: -1,
    });
    expect(deps.applyConversationReadStateLocally).not.toHaveBeenCalled();
    expect(deps.afterListMutation).toHaveBeenCalledWith({ clearBulkSelection: false });
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Отмечено как прочитанное: 4.');
  });

  it('updates the selected conversation in conversations view', async () => {
    const selectedConversation = {
      conversation_id: 'conv-9',
      unread_count: 2,
      messages_count: 5,
    };
    const deps = createDeps({
      viewMode: 'conversations',
      selectedConversation,
      selectedMessage: { id: 'msg-1', is_read: false },
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.applyConversationReadStateLocally).toHaveBeenCalledWith({
      conversationId: 'conv-9',
      isRead: true,
      unreadCount: 2,
      messageCount: 5,
      unreadDelta: -2,
    });
    expect(deps.applyMessageReadStateLocally).not.toHaveBeenCalled();
  });

  it('omits an empty mailbox id and defaults folder_scope to current', async () => {
    const deps = createDeps({
      activeMailboxId: '',
      folderScope: '',
      selectedMessage: { id: 'msg-1', is_read: true },
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.markAllRead).toHaveBeenCalledWith({
      mailbox_id: undefined,
      folder: 'inbox',
      folder_scope: 'current',
    });
    expect(deps.applyMessageReadStateLocally).not.toHaveBeenCalled();
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Отмечено как прочитанное: 4.');
  });

  it('returns quietly when credentials are required', async () => {
    const error = new Error('need credentials');
    const deps = createDeps({
      mailAPI: {
        markAllRead: vi.fn(async () => {
          throw error;
        }),
      },
      handleMailCredentialsRequired: vi.fn(async () => true),
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.handleMailCredentialsRequired).toHaveBeenCalledWith(
      error,
      'Не удалось отметить письма как прочитанные.',
    );
    expect(deps.setError).not.toHaveBeenCalled();
    expect(deps.afterListMutation).not.toHaveBeenCalled();
  });

  it('surfaces other mark-all-read failures', async () => {
    const error = new Error('ews down');
    const deps = createDeps({
      mailAPI: {
        markAllRead: vi.fn(async () => {
          throw error;
        }),
      },
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.setError).toHaveBeenCalledWith('Не удалось отметить письма как прочитанные.');
    expect(deps.notifyMailSuccess).not.toHaveBeenCalled();
  });

  it('marks only loaded unread messages via bulk action while filters are active', async () => {
    const deps = createDeps({
      hasNarrowingFilters: true,
      listItems: [
        { id: 'msg-1', is_read: false },
        { id: 'msg-2', is_read: true },
        { id: 'msg-3', is_read: false },
      ],
      mailAPI: {
        markAllRead: vi.fn(async () => ({ changed: 99 })),
        bulkMessageAction: vi.fn(async () => ({ succeeded: 2 })),
      },
      selectedMessage: null,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.bulkMessageAction).toHaveBeenCalledWith({
      mailbox_id: 'mailbox-1',
      message_ids: ['msg-1', 'msg-3'],
      action: 'mark_read',
    });
    expect(deps.mailAPI.markAllRead).not.toHaveBeenCalled();
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Отмечено как прочитанное: 2.');
  });

  it('reports bulk mark_read failures instead of claiming the request count', async () => {
    // Regression (MAIL-07): succeeded=0 + failed=2 must not be shown as
    // "Отмечено как прочитанное: 2".
    const deps = createDeps({
      hasNarrowingFilters: true,
      listItems: [
        { id: 'msg-1', is_read: false },
        { id: 'msg-2', is_read: false },
      ],
      mailAPI: {
        markAllRead: vi.fn(async () => ({ changed: 99 })),
        bulkMessageAction: vi.fn(async () => ({ ok: false, succeeded: 0, failed: 2 })),
      },
      selectedMessage: null,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.setError).toHaveBeenCalledWith(expect.stringContaining('2'));
    expect(deps.notifyMailSuccess).not.toHaveBeenCalled();
  });

  it('surfaces partial mark-all failures returned by the folder endpoint', async () => {
    const deps = createDeps({
      mailAPI: {
        markAllRead: vi.fn(async () => ({ ok: false, changed: 3, failed: 1 })),
      },
      selectedMessage: null,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.setError).toHaveBeenCalledWith(expect.stringContaining('1'));
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Отмечено как прочитанное: 3.');
  });

  it('marks only unread loaded conversations while filters are active', async () => {
    const deps = createDeps({
      hasNarrowingFilters: true,
      viewMode: 'conversations',
      listItems: [
        { conversation_id: 'conv-1', unread_count: 3 },
        { conversation_id: 'conv-2', unread_count: 0 },
      ],
      mailAPI: {
        markAllRead: vi.fn(async () => ({ changed: 99 })),
        markConversationAsRead: vi.fn(async () => ({})),
      },
      selectedConversation: null,
      selectedMessage: null,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.markConversationAsRead).toHaveBeenCalledTimes(1);
    expect(deps.mailAPI.markConversationAsRead).toHaveBeenCalledWith('conv-1', {
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      folder_scope: 'current',
    });
    expect(deps.mailAPI.markAllRead).not.toHaveBeenCalled();
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Отмечено как прочитанное: 1.');
  });

  it('does not call the API when the filtered list has no unread items', async () => {
    const deps = createDeps({
      hasNarrowingFilters: true,
      listItems: [{ id: 'msg-1', is_read: true }],
      mailAPI: {
        markAllRead: vi.fn(async () => ({ changed: 5 })),
        bulkMessageAction: vi.fn(async () => ({ succeeded: 1 })),
      },
      selectedMessage: null,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.markAllRead).not.toHaveBeenCalled();
    expect(deps.mailAPI.bulkMessageAction).not.toHaveBeenCalled();
    expect(deps.afterListMutation).not.toHaveBeenCalled();
    expect(deps.notifyMailSuccess).toHaveBeenCalledWith('Непрочитанных писем в текущей выборке нет.');
  });

  it('asks for confirmation before marking the whole mailbox in all-folders scope', async () => {
    const confirmAllScopeRead = vi.fn(() => true);
    const deps = createDeps({
      folderScope: 'all',
      confirmAllScopeRead,
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(confirmAllScopeRead).toHaveBeenCalledWith({ folderScope: 'all' });
    expect(deps.mailAPI.markAllRead).toHaveBeenCalledWith({
      mailbox_id: 'mailbox-1',
      folder: 'inbox',
      folder_scope: 'all',
    });
  });

  it('aborts the all-folders mark-all when the confirmation is declined', async () => {
    const deps = createDeps({
      folderScope: 'all',
      confirmAllScopeRead: vi.fn(() => false),
    });
    const { result } = renderHook(() => useMailMarkAllRead(deps));

    await result.current();

    expect(deps.mailAPI.markAllRead).not.toHaveBeenCalled();
    expect(deps.afterListMutation).not.toHaveBeenCalled();
    expect(deps.notifyMailSuccess).not.toHaveBeenCalled();
  });
});

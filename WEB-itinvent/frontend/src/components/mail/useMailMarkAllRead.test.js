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
});

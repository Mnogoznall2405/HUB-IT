import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailSelectedPreviewActions from './useMailSelectedPreviewActions';

const createMailAPI = (overrides = {}) => ({
  moveMessage: vi.fn(async () => ({})),
  restoreMessage: vi.fn(async () => ({})),
  deleteMessage: vi.fn(async () => ({})),
  ...overrides,
});

const createProps = (overrides = {}) => ({
  afterListMutation: vi.fn(async () => ({})),
  clearSelection: vi.fn(),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  handleMailCredentialsRequired: vi.fn(async () => false),
  mailAPI: createMailAPI(),
  moveTarget: 'archive',
  performMailReadMutation: vi.fn(async () => true),
  selectedConversation: {
    conversation_id: 'conv-1',
    unread_count: 2,
    messages_count: 5,
    items: [{ id: 'msg-1' }, { id: 'msg-2' }],
  },
  selectedMessage: {
    id: 'msg-1',
    is_read: false,
    restore_hint_folder: 'inbox',
  },
  setError: vi.fn(),
  viewMode: 'messages',
  withActiveMailboxPayload: vi.fn((payload) => ({ mailbox_id: 'mailbox-1', ...payload })),
  ...overrides,
});

describe('useMailSelectedPreviewActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles selected message read state with message read counts', async () => {
    const props = createProps({
      selectedMessage: { id: 'msg-1', is_read: false },
      viewMode: 'messages',
    });
    const { result } = renderHook(() => useMailSelectedPreviewActions(props));

    await act(async () => {
      await result.current.handleToggleReadState();
    });

    expect(props.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'messages',
      targetId: 'msg-1',
      nextIsRead: true,
      currentUnreadCount: 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось изменить статус письма.',
    });
    expect(result.current.messageActionLoading).toBe(false);
  });

  it('toggles selected conversation read state with conversation unread counts', async () => {
    const props = createProps({
      viewMode: 'conversations',
      selectedConversation: {
        conversation_id: 'conv-1',
        unread_count: 3,
        messages_count: 7,
        items: [{ id: 'msg-1' }],
      },
    });
    const { result } = renderHook(() => useMailSelectedPreviewActions(props));

    await act(async () => {
      await result.current.handleToggleReadState();
    });

    expect(props.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'conversations',
      targetId: 'conv-1',
      nextIsRead: true,
      currentUnreadCount: 3,
      currentMessageCount: 7,
      errorMessage: 'Не удалось изменить статус диалога.',
    });
  });

  it('restores, deletes, and moves the selected message then clears selection and refreshes list state', async () => {
    const mailAPI = createMailAPI();
    const props = createProps({
      mailAPI,
      moveTarget: 'junk',
      selectedMessage: { id: 'msg-1', restore_hint_folder: 'inbox' },
    });
    const { result } = renderHook(() => useMailSelectedPreviewActions(props));

    await act(async () => {
      await result.current.handleRestoreSelectedMessage();
      await result.current.handleDeleteSelectedMessage(false);
      await result.current.handleMoveSelectedMessage();
    });

    expect(mailAPI.restoreMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'inbox' });
    expect(mailAPI.deleteMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', permanent: false });
    expect(mailAPI.moveMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'junk' });
    expect(props.clearSelection).toHaveBeenCalledTimes(3);
    expect(props.clearSelection).toHaveBeenCalledWith({ mode: 'messages' });
    expect(props.afterListMutation).toHaveBeenCalledTimes(3);
  });

  it('archives and permanently deletes with the expected payloads', async () => {
    const mailAPI = createMailAPI();
    const props = createProps({ mailAPI, selectedMessage: { id: 'msg-1' } });
    const { result } = renderHook(() => useMailSelectedPreviewActions(props));

    await act(async () => {
      await result.current.handleArchiveSelectedMessage();
      await result.current.handleDeleteSelectedMessage(true);
    });

    expect(mailAPI.moveMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'archive' });
    expect(mailAPI.deleteMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', permanent: true });
  });

  it('delegates credential-required errors, skips generic error, and resets loading on failure', async () => {
    const requestError = new Error('credentials required');
    const mailAPI = createMailAPI({
      moveMessage: vi.fn(async () => {
        throw requestError;
      }),
    });
    const props = createProps({
      mailAPI,
      handleMailCredentialsRequired: vi.fn(async () => true),
      selectedMessage: { id: 'msg-1' },
    });
    const { result } = renderHook(() => useMailSelectedPreviewActions(props));

    await act(async () => {
      await result.current.handleArchiveSelectedMessage();
    });

    expect(props.handleMailCredentialsRequired).toHaveBeenCalledWith(requestError, 'Не удалось отправить письмо в архив.');
    expect(props.setError).not.toHaveBeenCalled();
    expect(props.clearSelection).not.toHaveBeenCalled();
    expect(props.afterListMutation).not.toHaveBeenCalled();
    expect(result.current.messageActionLoading).toBe(false);
  });
});

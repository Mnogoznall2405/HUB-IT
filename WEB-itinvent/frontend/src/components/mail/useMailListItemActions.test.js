import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailListItemActions from './useMailListItemActions';

const createMailAPI = (overrides = {}) => ({
  getMessage: vi.fn(async () => ({ id: 'msg-api', body_html: '<p>API body</p>' })),
  deleteMessage: vi.fn(async () => ({})),
  restoreMessage: vi.fn(async () => ({})),
  moveMessage: vi.fn(async () => ({})),
  ...overrides,
});

const createProps = (overrides = {}) => ({
  mailAPI: createMailAPI(),
  viewMode: 'messages',
  folder: 'inbox',
  selectedMessage: { id: 'msg-1', body_html: '<p>Selected body</p>', is_read: false },
  performMailReadMutation: vi.fn(async () => true),
  afterListMutation: vi.fn(async () => ({})),
  clearSelection: vi.fn(),
  handleMailCredentialsRequired: vi.fn(async () => false),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  getRecentMessageDetailSnapshot: vi.fn(() => null),
  persistRecentMessageDetailSnapshot: vi.fn(),
  resolveItemMailboxId: vi.fn((item) => item?.mailbox_id || 'mailbox-1'),
  withActiveMailboxPayload: vi.fn((payload) => ({ mailbox_id: 'mailbox-1', ...payload })),
  setError: vi.fn(),
  ...overrides,
});

describe('useMailListItemActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves list action message detail from selected detail, recent detail, then API and persists API detail', async () => {
    const selectedProps = createProps({
      selectedMessage: { id: 'msg-1', body_html: '<p>Selected body</p>' },
      getRecentMessageDetailSnapshot: vi.fn(() => ({ id: 'msg-1', body_html: '<p>Recent body</p>' })),
    });
    const selectedHook = renderHook(() => useMailListItemActions(selectedProps));

    await expect(selectedHook.result.current.getMessageDetailForListAction({ id: 'msg-1' }))
      .resolves.toBe(selectedProps.selectedMessage);
    expect(selectedProps.getRecentMessageDetailSnapshot).not.toHaveBeenCalled();
    expect(selectedProps.mailAPI.getMessage).not.toHaveBeenCalled();

    const recentDetail = { id: 'msg-2', body_html: '<p>Recent body</p>' };
    const recentProps = createProps({
      selectedMessage: { id: 'msg-1', body_html: '<p>Selected body</p>' },
      getRecentMessageDetailSnapshot: vi.fn(() => recentDetail),
    });
    const recentHook = renderHook(() => useMailListItemActions(recentProps));

    await expect(recentHook.result.current.getMessageDetailForListAction({ id: 'msg-2' }))
      .resolves.toBe(recentDetail);
    expect(recentProps.mailAPI.getMessage).not.toHaveBeenCalled();

    const apiDetail = { id: 'msg-3', body_html: '<p>API body</p>' };
    const apiProps = createProps({
      mailAPI: createMailAPI({ getMessage: vi.fn(async () => apiDetail) }),
      selectedMessage: { id: 'msg-1', body_html: '<p>Selected body</p>' },
      getRecentMessageDetailSnapshot: vi.fn(() => null),
    });
    const apiHook = renderHook(() => useMailListItemActions(apiProps));

    await expect(apiHook.result.current.getMessageDetailForListAction({ id: 'msg-3', mailbox_id: 'mailbox-3' }))
      .resolves.toBe(apiDetail);
    expect(apiProps.mailAPI.getMessage).toHaveBeenCalledWith('msg-3', { mailboxId: 'mailbox-3' });
    expect(apiProps.persistRecentMessageDetailSnapshot).toHaveBeenCalledWith(apiDetail);
  });

  it('passes conversation swipe read arguments through the read mutation service', async () => {
    const props = createProps({ viewMode: 'conversations' });
    const { result } = renderHook(() => useMailListItemActions(props));

    await act(async () => {
      await result.current.handleSwipeRead({
        id: 'fallback-conv',
        conversation_id: 'conv-1',
        unread_count: 3,
        messages_count: 7,
        items: [{ id: 'msg-1' }],
      });
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

  it('passes message swipe read arguments through the read mutation service', async () => {
    const props = createProps({ viewMode: 'messages' });
    const { result } = renderHook(() => useMailListItemActions(props));

    await act(async () => {
      await result.current.handleSwipeRead({ id: 'msg-1', is_read: false });
    });

    expect(props.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'messages',
      targetId: 'msg-1',
      nextIsRead: true,
      currentUnreadCount: 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось изменить статус письма.',
    });
  });

  it('sends delete, restore, archive, and move payloads and clears the selected row item', async () => {
    const mailAPI = createMailAPI();
    const props = createProps({
      mailAPI,
      folder: 'trash',
      selectedMessage: { id: 'msg-1', body_html: '<p>Selected body</p>' },
    });
    const { result } = renderHook(() => useMailListItemActions(props));

    await act(async () => {
      await result.current.handleSwipeDelete({ id: 'msg-1' });
      await result.current.handleListRestoreMessage({ id: 'msg-1', restore_hint_folder: 'sent' });
      await result.current.handleListArchiveMessage({ id: 'msg-1' });
      await result.current.handleListMoveMessage({ id: 'msg-1' }, 'custom-folder');
    });

    expect(mailAPI.deleteMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', permanent: true });
    expect(mailAPI.restoreMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'sent' });
    expect(mailAPI.moveMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'archive' });
    expect(mailAPI.moveMessage).toHaveBeenCalledWith('msg-1', { mailbox_id: 'mailbox-1', target_folder: 'custom-folder' });
    expect(props.clearSelection).toHaveBeenCalledTimes(4);
    expect(props.clearSelection).toHaveBeenCalledWith({ mode: 'messages' });
    expect(props.afterListMutation).toHaveBeenCalledTimes(4);
  });

  it('delegates credentials-required errors without setting a generic error', async () => {
    const requestError = new Error('credentials required');
    const props = createProps({
      mailAPI: createMailAPI({
        deleteMessage: vi.fn(async () => {
          throw requestError;
        }),
      }),
      handleMailCredentialsRequired: vi.fn(async () => true),
    });
    const { result } = renderHook(() => useMailListItemActions(props));

    await act(async () => {
      await result.current.handleSwipeDelete({ id: 'msg-1' });
    });

    expect(props.handleMailCredentialsRequired).toHaveBeenCalledWith(requestError, 'Не удалось удалить письмо.');
    expect(props.setError).not.toHaveBeenCalled();
    expect(props.clearSelection).not.toHaveBeenCalled();
    expect(props.afterListMutation).not.toHaveBeenCalled();
  });
});

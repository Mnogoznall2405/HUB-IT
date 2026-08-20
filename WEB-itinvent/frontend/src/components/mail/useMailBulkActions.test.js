import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailBulkActions, { normalizeSelectedMessageIds } from './useMailBulkActions';

describe('normalizeSelectedMessageIds', () => {
  it('keeps stable unique message ids for bulk actions', () => {
    expect(normalizeSelectedMessageIds(['msg-1', '', null, 'msg-2', 'msg-1'])).toEqual(['msg-1', 'msg-2']);
  });
});

const createProps = (overrides = {}) => ({
  mailAPI: {
    bulkMessageAction: vi.fn(async () => ({})),
  },
  activeMailboxId: 'mailbox-1',
  folder: 'trash',
  selectedItems: ['msg-1', 'msg-2'],
  setSelectedItems: vi.fn(),
  setMoveTarget: vi.fn(),
  selectedMessage: { id: 'msg-1' },
  viewMode: 'messages',
  clearSelection: vi.fn(),
  invalidateMailClientCache: vi.fn(),
  refreshList: vi.fn(async () => ({})),
  refreshFolderSummary: vi.fn(async () => ({})),
  withActiveMailboxPayload: vi.fn((payload) => payload),
  handleMailCredentialsRequired: vi.fn(async () => false),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  onError: vi.fn(),
  onMessage: vi.fn(),
  confirmPermanentDelete: vi.fn(() => true),
  onRecoverableDelete: vi.fn(),
  ...overrides,
});

describe('useMailBulkActions permanent delete confirm', () => {
  it('asks once for a bulk permanent delete then calls the API', async () => {
    const props = createProps();
    const { result } = renderHook(() => useMailBulkActions(props));

    await act(async () => {
      await result.current.runBulkAction({
        action: 'delete',
        permanent: true,
        successMessage: 'Выбранные письма удалены навсегда.',
      });
    });

    expect(props.confirmPermanentDelete).toHaveBeenCalledTimes(1);
    expect(props.confirmPermanentDelete).toHaveBeenCalledWith({ count: 2 });
    expect(props.mailAPI.bulkMessageAction).toHaveBeenCalledWith({
      mailbox_id: 'mailbox-1',
      message_ids: ['msg-1', 'msg-2'],
      action: 'delete',
      target_folder: undefined,
      permanent: true,
    });
    expect(props.onMessage).toHaveBeenCalledWith('Выбранные письма удалены навсегда.');
    expect(props.onRecoverableDelete).not.toHaveBeenCalled();
  });

  it('does not confirm recoverable bulk delete', async () => {
    const props = createProps({
      folder: 'inbox',
      mailAPI: {
        bulkMessageAction: vi.fn(async () => ({
          results: [
            { message_id: 'msg-1', result: { message_id: 'trash-1', folder: 'trash' } },
            { message_id: 'msg-2', result: { message_id: 'trash-2', folder: 'trash' } },
          ],
        })),
      },
    });
    const { result } = renderHook(() => useMailBulkActions(props));

    await act(async () => {
      await result.current.runBulkAction({
        action: 'delete',
        permanent: false,
        successMessage: 'Выбранные письма перемещены в удаленные.',
      });
    });

    expect(props.confirmPermanentDelete).not.toHaveBeenCalled();
    expect(props.mailAPI.bulkMessageAction).toHaveBeenCalled();
    expect(props.onRecoverableDelete).toHaveBeenCalledWith({
      messageIds: ['trash-1', 'trash-2'],
      restoreFolder: 'inbox',
      count: 2,
    });
    expect(props.onMessage).not.toHaveBeenCalled();
  });

  it('skips the bulk API when permanent confirm is cancelled', async () => {
    const props = createProps({
      confirmPermanentDelete: vi.fn(() => false),
    });
    const { result } = renderHook(() => useMailBulkActions(props));

    await act(async () => {
      await result.current.runBulkAction({
        action: 'delete',
        permanent: true,
      });
    });

    expect(props.mailAPI.bulkMessageAction).not.toHaveBeenCalled();
    expect(props.clearSelection).not.toHaveBeenCalled();
    expect(props.refreshList).not.toHaveBeenCalled();
  });
});

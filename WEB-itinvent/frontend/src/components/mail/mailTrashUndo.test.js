import { describe, expect, it, vi } from 'vitest';
import {
  MAIL_TRASH_UNDO_ACTION_LABEL,
  MAIL_TRASH_UNDO_DURATION_MS,
  buildMailTrashRestoredMessage,
  buildMailTrashUndoMessage,
  createMailTrashUndoNotifier,
  extractBulkTrashRestoreIds,
  extractTrashRestoreMessageId,
} from './mailTrashUndo';

describe('mailTrashUndo', () => {
  it('builds copy for one message and a bulk pack', () => {
    expect(buildMailTrashUndoMessage({ count: 1 })).toBe('Письмо перемещено в удаленные.');
    expect(buildMailTrashUndoMessage({ count: 3 })).toBe('Выбранные письма перемещены в удаленные (3).');
    expect(buildMailTrashRestoredMessage({ count: 1 })).toBe('Письмо восстановлено.');
    expect(buildMailTrashRestoredMessage({ count: 2 })).toBe('Письма восстановлены.');
  });

  it('extracts trash restore ids and ignores permanent or other-folder moves', () => {
    expect(extractTrashRestoreMessageId({ message_id: 'trash-1', folder: 'trash' })).toBe('trash-1');
    expect(extractTrashRestoreMessageId({ message_id: 'msg-1' })).toBe('msg-1');
    expect(extractTrashRestoreMessageId({ message_id: 'arch-1', folder: 'archive' })).toBe('');
    expect(extractTrashRestoreMessageId({ permanent: true, message_id: 'gone' })).toBe('');
    expect(extractBulkTrashRestoreIds({
      results: [
        { message_id: 'old-1', result: { message_id: 'trash-1', folder: 'trash' } },
        { message_id: 'old-2', result: { message_id: 'trash-2', folder: 'trash' } },
        { message_id: 'old-3', result: { permanent: true } },
      ],
    })).toEqual(['trash-1', 'trash-2']);
  });

  it('shows an undo toast and restores with the captured folder', async () => {
    const notifySuccess = vi.fn();
    const restoreMessage = vi.fn(async () => ({}));
    const afterUndo = vi.fn(async () => ({}));
    const notifyRecoverableDelete = createMailTrashUndoNotifier({
      notifySuccess,
      mailAPI: { restoreMessage },
      withActiveMailboxPayload: (payload) => ({ mailbox_id: 'mailbox-1', ...payload }),
      afterUndo,
    });

    notifyRecoverableDelete({
      messageIds: ['trash-1', 'trash-2'],
      restoreFolder: 'sent',
      count: 2,
    });

    expect(notifySuccess).toHaveBeenCalledWith(
      'Выбранные письма перемещены в удаленные (2).',
      expect.objectContaining({
        durationMs: MAIL_TRASH_UNDO_DURATION_MS,
        actionLabel: MAIL_TRASH_UNDO_ACTION_LABEL,
      }),
    );

    await notifySuccess.mock.calls[0][1].onAction();

    expect(restoreMessage).toHaveBeenNthCalledWith(1, 'trash-1', { mailbox_id: 'mailbox-1', target_folder: 'sent' });
    expect(restoreMessage).toHaveBeenNthCalledWith(2, 'trash-2', { mailbox_id: 'mailbox-1', target_folder: 'sent' });
    expect(afterUndo).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenLastCalledWith('Письма восстановлены.');
  });

  it('does not attach undo when restore ids are missing', () => {
    const notifySuccess = vi.fn();
    const notifyRecoverableDelete = createMailTrashUndoNotifier({ notifySuccess });
    notifyRecoverableDelete({ messageIds: [], restoreFolder: 'inbox', count: 1 });
    expect(notifySuccess).toHaveBeenCalledWith(
      'Письмо перемещено в удаленные.',
      expect.objectContaining({ durationMs: MAIL_TRASH_UNDO_DURATION_MS }),
    );
    expect(notifySuccess.mock.calls[0][1].onAction).toBeUndefined();
  });
});

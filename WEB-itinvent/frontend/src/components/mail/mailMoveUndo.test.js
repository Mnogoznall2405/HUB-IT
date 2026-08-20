import { describe, expect, it, vi } from 'vitest';
import {
  MAIL_MOVE_UNDO_ACTION_LABEL,
  MAIL_MOVE_UNDO_DURATION_MS,
  buildMailMoveRestoredMessage,
  buildMailMoveUndoMessage,
  createMailMoveUndoNotifier,
} from './mailMoveUndo';

describe('mailMoveUndo', () => {
  it('builds copy for one message and a bulk pack', () => {
    expect(buildMailMoveUndoMessage({ count: 1, folderLabel: 'Архив' })).toBe('Письмо перемещено в «Архив»');
    expect(buildMailMoveUndoMessage({ count: 12, folderLabel: 'Удаленные' })).toBe('12 писем перемещено в «Удаленные»');
    expect(buildMailMoveRestoredMessage({ count: 1 })).toBe('Перемещение письма отменено.');
    expect(buildMailMoveRestoredMessage({ count: 2 })).toBe('Перемещение писем отменено.');
  });

  it('shows an undo toast and moves messages back to the source folder', async () => {
    const notifySuccess = vi.fn();
    const moveMessage = vi.fn(async () => ({}));
    const afterUndo = vi.fn(async () => ({}));
    const notifyRecoverableMove = createMailMoveUndoNotifier({
      notifySuccess,
      mailAPI: { moveMessage },
      withActiveMailboxPayload: (payload) => ({ mailbox_id: 'mailbox-1', ...payload }),
      afterUndo,
    });

    notifyRecoverableMove({
      messageIds: ['msg-1', 'msg-2'],
      restoreFolder: 'inbox',
      folderLabel: 'Архив',
      count: 2,
    });

    expect(notifySuccess).toHaveBeenCalledWith(
      '2 писем перемещено в «Архив»',
      expect.objectContaining({
        durationMs: MAIL_MOVE_UNDO_DURATION_MS,
        actionLabel: MAIL_MOVE_UNDO_ACTION_LABEL,
      }),
    );

    await notifySuccess.mock.calls[0][1].onAction();

    expect(moveMessage).toHaveBeenNthCalledWith(1, 'msg-1', { mailbox_id: 'mailbox-1', target_folder: 'inbox' });
    expect(moveMessage).toHaveBeenNthCalledWith(2, 'msg-2', { mailbox_id: 'mailbox-1', target_folder: 'inbox' });
    expect(afterUndo).toHaveBeenCalledTimes(1);
    expect(notifySuccess).toHaveBeenLastCalledWith('Перемещение писем отменено.');
  });
});

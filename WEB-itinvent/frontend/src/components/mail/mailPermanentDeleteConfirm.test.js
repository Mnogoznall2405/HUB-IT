import { describe, expect, it, vi } from 'vitest';
import {
  buildMailPermanentDeleteConfirmMessage,
  confirmMailPermanentDelete,
} from './mailPermanentDeleteConfirm';

describe('mailPermanentDeleteConfirm', () => {
  it('builds folder-style copy for one message and for a bulk pack', () => {
    expect(buildMailPermanentDeleteConfirmMessage({ count: 1 }))
      .toBe('Удалить это письмо навсегда? Это действие нельзя отменить.');
    expect(buildMailPermanentDeleteConfirmMessage({ count: 3 }))
      .toBe('Удалить выбранные письма навсегда (3)? Это действие нельзя отменить.');
  });

  it('asks window.confirm and returns the answer', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(confirmMailPermanentDelete({ count: 1 })).toBe(true);
    expect(confirmMailPermanentDelete({ count: 4 })).toBe(false);
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      'Удалить это письмо навсегда? Это действие нельзя отменить.',
    );
    expect(confirm).toHaveBeenNthCalledWith(
      2,
      'Удалить выбранные письма навсегда (4)? Это действие нельзя отменить.',
    );
    confirm.mockRestore();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createMailListRefreshAfterUndo, MAIL_LIST_REFRESHED_EVENT } from './mailListUndoRefresh';

describe('createMailListRefreshAfterUndo', () => {
  it('invalidates cache, refreshes list and folders, then notifies the shell', async () => {
    const calls = [];
    const invalidateMailClientCache = vi.fn(() => calls.push('invalidate'));
    const refreshList = vi.fn(async () => {
      calls.push('list');
    });
    const refreshFolderSummary = vi.fn(async () => {
      calls.push('summary');
    });
    const onRefreshed = vi.fn(() => calls.push('event'));
    window.addEventListener(MAIL_LIST_REFRESHED_EVENT, onRefreshed);

    const afterUndo = createMailListRefreshAfterUndo({
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
    });
    await afterUndo();

    window.removeEventListener(MAIL_LIST_REFRESHED_EVENT, onRefreshed);
    expect(refreshList).toHaveBeenCalledWith({ silent: true, force: true });
    expect(refreshFolderSummary).toHaveBeenCalledWith({ force: true });
    expect(calls).toEqual(['invalidate', 'list', 'summary', 'event']);
  });
});

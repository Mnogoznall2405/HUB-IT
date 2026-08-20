export const MAIL_LIST_REFRESHED_EVENT = 'mail-list-refreshed';

export function dispatchMailListRefreshed() {
  window.dispatchEvent(new CustomEvent(MAIL_LIST_REFRESHED_EVENT));
}

export function createMailListRefreshAfterUndo({
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
} = {}) {
  return async () => {
    invalidateMailClientCache();
    await Promise.all([
      refreshList({ silent: true, force: true }),
      refreshFolderSummary({ force: true }),
    ]);
    dispatchMailListRefreshed();
  };
}

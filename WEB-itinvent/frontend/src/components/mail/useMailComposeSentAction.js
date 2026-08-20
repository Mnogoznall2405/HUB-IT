import { useCallback } from 'react';

export default function useMailComposeSentAction({
  closeComposeSession,
  notifyMailSuccess,
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
} = {}) {
  return useCallback(async () => {
    closeComposeSession();
    notifyMailSuccess('Письмо отправлено.');
    invalidateMailClientCache();
    await refreshList({ silent: true, force: true });
    await refreshFolderSummary();
  }, [closeComposeSession, invalidateMailClientCache, notifyMailSuccess, refreshFolderSummary, refreshList]);
}

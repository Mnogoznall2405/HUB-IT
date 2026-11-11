import { useCallback } from 'react';

export default function useMailComposeDraftSavedAction({
  notifyMailSuccess,
  invalidateMailClientCache,
  refreshFolderSummary,
} = {}) {
  return useCallback(async () => {
    notifyMailSuccess('Письмо сохранено в черновики.');
    invalidateMailClientCache();
    await refreshFolderSummary({ force: true });
  }, [invalidateMailClientCache, notifyMailSuccess, refreshFolderSummary]);
}

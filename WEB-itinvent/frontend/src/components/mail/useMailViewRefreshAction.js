import { useCallback } from 'react';

export default function useMailViewRefreshAction({
  invalidateMailClientCache,
  refreshList,
  refreshFolderSummary,
  refreshFolderTree,
} = {}) {
  return useCallback(() => {
    invalidateMailClientCache();
    refreshList({ force: true });
    refreshFolderSummary();
    refreshFolderTree();
  }, [invalidateMailClientCache, refreshFolderSummary, refreshFolderTree, refreshList]);
}

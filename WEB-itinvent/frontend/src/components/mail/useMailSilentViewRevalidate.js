import { useCallback } from 'react';

export default function useMailSilentViewRevalidate({
  mailAccessReady,
  mailConfigLoading,
  mailCacheScope,
  currentListContextKey,
  viewMode,
  folder,
  mailboxInfo,
  folderTreeRef,
  folderSummaryRef,
  folderSummaryRefreshCompletedAtRef,
  selectedIdRef,
  hasFreshSelectedMailDetail,
  refreshBootstrap,
  refreshList,
  refreshFolderSummary,
  revalidateSelectedMailDetail,
  runMailViewRefreshGate,
  setMailBackgroundRefreshing,
  folderSummaryRefreshCooldownMs,
} = {}) {
  return useCallback(async ({ reason = 'auto', force = false } = {}) => {
    if (!mailAccessReady) return;
    // During mailbox switch bootstrap owns the refresh; timer/focus must not stack more work.
    if (mailConfigLoading) return;
    const refreshKey = `${mailCacheScope}:${currentListContextKey}:${viewMode}:${folder}`;
    return runMailViewRefreshGate(refreshKey, async () => {
      setMailBackgroundRefreshing(true);
      try {
        const shouldFallbackToBootstrap = !mailboxInfo
          || !folderTreeRef.current?.length
          || !Object.keys(folderSummaryRef.current || {}).length;
        const shouldRefreshFolderSummary = shouldFallbackToBootstrap
          || reason === 'mail-needs-refresh'
          || !Object.keys(folderSummaryRef.current || {}).length
          || (Date.now() - Number(folderSummaryRefreshCompletedAtRef.current || 0)) >= folderSummaryRefreshCooldownMs;
        const tasks = shouldFallbackToBootstrap
          ? [refreshBootstrap({ force: true })]
          : [refreshList({ silent: true, force: true })];
        if (!shouldFallbackToBootstrap && shouldRefreshFolderSummary) {
          tasks.unshift(refreshFolderSummary({ force: reason === 'mail-needs-refresh' }));
        }
        if (selectedIdRef.current) {
          const shouldRevalidateSelectedDetail = reason === 'mail-needs-refresh'
            || !hasFreshSelectedMailDetail({ detailId: selectedIdRef.current, mode: viewMode });
          if (shouldRevalidateSelectedDetail) {
            tasks.push(revalidateSelectedMailDetail({ force: reason === 'mail-needs-refresh' }));
          }
        }
        await Promise.allSettled(tasks);
      } finally {
        setMailBackgroundRefreshing(false);
      }
    }, {
      force,
      bypassCooldown: reason === 'mail-needs-refresh',
    });
  }, [
    currentListContextKey,
    folder,
    folderSummaryRef,
    folderSummaryRefreshCompletedAtRef,
    folderSummaryRefreshCooldownMs,
    folderTreeRef,
    hasFreshSelectedMailDetail,
    mailAccessReady,
    mailCacheScope,
    mailConfigLoading,
    mailboxInfo,
    refreshBootstrap,
    refreshFolderSummary,
    refreshList,
    revalidateSelectedMailDetail,
    runMailViewRefreshGate,
    selectedIdRef,
    setMailBackgroundRefreshing,
    viewMode,
  ]);
}

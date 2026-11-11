import { useEffect } from 'react';

export default function useMailListAccessRefresh({
  mailAccessReady,
  currentListContextKey,
  lastListRefreshContextKeyRef,
  skipNextListRefreshRef,
  refreshList,
} = {}) {
  useEffect(() => {
    if (!mailAccessReady) return;
    const previousContextKey = String(lastListRefreshContextKeyRef.current || '');
    const nextContextKey = String(currentListContextKey || '');
    const isFirstContext = !previousContextKey;
    const contextChanged = previousContextKey !== nextContextKey;
    if (skipNextListRefreshRef.current) {
      skipNextListRefreshRef.current = false;
      // Skip only the duplicate pull for the already-painted context.
      // Folder/filter changes must still fetch immediately (skip must not swallow them).
      if (!contextChanged || isFirstContext) {
        lastListRefreshContextKeyRef.current = nextContextKey;
        return;
      }
    }
    // handleFolderChange already kicked an immediate fetch for this context.
    if (!contextChanged && !isFirstContext) {
      return;
    }
    lastListRefreshContextKeyRef.current = nextContextKey;
    // Force network on folder/filter changes so a stale/empty SWR entry cannot stick for 45s.
    void refreshList({
      force: contextChanged && !isFirstContext,
      reason: contextChanged && !isFirstContext ? 'context-effect' : 'access-ready',
      startedAt: Date.now(),
    });
    // Depend on currentListContextKey (folder/filters/view/scope), not refreshList:
    // refreshList identity churn was re-firing full pulls and freezing mailbox switches,
    // but omitting the list context entirely broke Sent/Drafts/etc. folder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailAccessReady, currentListContextKey]);
}

import { useEffect } from 'react';

export default function useMailPendingListScrollRestore({
  isMobile,
  hasMobileSelection,
  currentListContextKey,
  pendingListScrollRestoreRef,
  messageListRef,
  listItemCount,
  listTotal,
} = {}) {
  useEffect(() => {
    if (!isMobile || hasMobileSelection) return undefined;
    const pendingRestore = pendingListScrollRestoreRef.current;
    if (!pendingRestore || pendingRestore.contextKey !== currentListContextKey) return undefined;
    const node = messageListRef.current;
    if (!node) return undefined;
    let restoreFrame = 0;
    let settleFrame = 0;
    restoreFrame = window.requestAnimationFrame(() => {
      node.scrollTop = Math.max(0, Number(pendingRestore.scrollTop || 0));
      settleFrame = window.requestAnimationFrame(() => {
        pendingListScrollRestoreRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [
    currentListContextKey,
    hasMobileSelection,
    isMobile,
    listItemCount,
    listTotal,
    messageListRef,
    pendingListScrollRestoreRef,
  ]);
}

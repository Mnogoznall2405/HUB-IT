import { useCallback } from 'react';

import { CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX } from './chatHelpers';

export default function useChatThreadViewport({
  showJumpToLatestRef,
  setShowJumpToLatest,
  threadNearBottomRef,
  threadViewportSyncFrameRef,
}) {
  const syncThreadViewportState = useCallback((node) => {
    if (!node) return;
    const nearBottom = (node.scrollHeight - node.scrollTop - node.clientHeight) <= CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX;
    threadNearBottomRef.current = nearBottom;
    const nextShowJumpToLatest = !nearBottom;
    if (showJumpToLatestRef.current !== nextShowJumpToLatest) {
      showJumpToLatestRef.current = nextShowJumpToLatest;
      setShowJumpToLatest(nextShowJumpToLatest);
    }
  }, [setShowJumpToLatest, showJumpToLatestRef, threadNearBottomRef]);

  const scheduleThreadViewportStateSync = useCallback((node) => {
    if (!node) return;
    const container = node;
    if (threadViewportSyncFrameRef.current !== null) return;
    threadViewportSyncFrameRef.current = window.requestAnimationFrame(() => {
      threadViewportSyncFrameRef.current = null;
      syncThreadViewportState(container);
    });
  }, [syncThreadViewportState, threadViewportSyncFrameRef]);

  return {
    scheduleThreadViewportStateSync,
    syncThreadViewportState,
  };
}

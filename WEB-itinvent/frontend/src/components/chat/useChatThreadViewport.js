import { useCallback, useRef } from 'react';

import { CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX } from './chatHelpers';

export default function useChatThreadViewport({
  showJumpToLatestRef,
  setShowJumpToLatest,
  threadNearBottomRef,
  threadViewportSyncFrameRef,
  messagesHasNewerRef,
  onApproachBottom,
}) {
  const onApproachBottomRef = useRef(onApproachBottom);
  onApproachBottomRef.current = onApproachBottom;

  const syncThreadViewportState = useCallback((node) => {
    if (!node) return;
    const nearBottom = (node.scrollHeight - node.scrollTop - node.clientHeight) <= CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX;
    threadNearBottomRef.current = nearBottom;
    const hasNewer = Boolean(messagesHasNewerRef?.current);
    // R19: while the window is cut off from the newest messages the jump
    // button stays visible even when the viewport sits at the loaded bottom.
    const nextShowJumpToLatest = !nearBottom || hasNewer;
    if (showJumpToLatestRef.current !== nextShowJumpToLatest) {
      showJumpToLatestRef.current = nextShowJumpToLatest;
      setShowJumpToLatest(nextShowJumpToLatest);
    }
    if (nearBottom && hasNewer) {
      onApproachBottomRef.current?.();
    }
  }, [messagesHasNewerRef, setShowJumpToLatest, showJumpToLatestRef, threadNearBottomRef]);

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

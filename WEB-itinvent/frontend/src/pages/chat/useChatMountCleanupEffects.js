import { useEffect } from 'react';

export default function useChatMountCleanupEffects({
  highlightResetTimeoutRef,
  threadViewportSyncFrameRef,
}) {
  useEffect(() => () => {
    if (highlightResetTimeoutRef.current) {
      window.clearTimeout(highlightResetTimeoutRef.current);
    }
    if (threadViewportSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(threadViewportSyncFrameRef.current);
      threadViewportSyncFrameRef.current = null;
    }
  }, [highlightResetTimeoutRef, threadViewportSyncFrameRef]);
}

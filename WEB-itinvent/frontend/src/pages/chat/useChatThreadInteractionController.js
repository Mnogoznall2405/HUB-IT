import { useCallback } from 'react';

import { buildActiveThreadPollLoadOptions } from './chatThreadTransport';

export default function useChatThreadInteractionController({
  activeConversationIdRef,
  cancelPendingInitialAnchor,
  clearInitialViewportGuard,
  isInitialViewportGuardActive,
  loadMessages,
  logChatDebug,
  messagesHasNewerRef,
  messagesRef,
  pendingInitialAnchorRef,
  queueAutoScroll,
  scheduleThreadViewportStateSync,
  scrollThreadBottomIntoView,
  setShowJumpToLatest,
  showJumpToLatestRef,
  suppressThreadScrollCancelRef,
  threadNearBottomRef,
}) {
  const handleThreadScroll = useCallback((event) => {
    const node = event?.currentTarget;
    if (!node) return;
    const pendingAnchor = pendingInitialAnchorRef.current;
    const lastAppliedTarget = Number(pendingAnchor?.lastAppliedTarget);
    const likelyManualScroll = suppressThreadScrollCancelRef.current
      && pendingAnchor?.conversationId === activeConversationIdRef.current
      && Number.isFinite(lastAppliedTarget)
      && Math.abs(Number(node.scrollTop || 0) - lastAppliedTarget) > 2;
    if (!suppressThreadScrollCancelRef.current || likelyManualScroll) {
      if (pendingAnchor?.conversationId === activeConversationIdRef.current) {
        logChatDebug('threadScroll:cancelPendingAnchor', {
          conversationId: pendingAnchor.conversationId,
          mode: pendingAnchor.mode,
          source: likelyManualScroll ? 'suppressed_manual_override' : 'user_scroll',
        });
        cancelPendingInitialAnchor();
      }
      if (isInitialViewportGuardActive(activeConversationIdRef.current)) {
        clearInitialViewportGuard(likelyManualScroll ? 'manual_scroll:suppressed_override' : 'manual_scroll');
      }
    }
    scheduleThreadViewportStateSync(node);
  }, [
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    clearInitialViewportGuard,
    isInitialViewportGuardActive,
    logChatDebug,
    pendingInitialAnchorRef,
    scheduleThreadViewportStateSync,
    suppressThreadScrollCancelRef,
  ]);

  const jumpToLatest = useCallback(async () => {
    cancelPendingInitialAnchor();
    threadNearBottomRef.current = true;
    showJumpToLatestRef.current = false;
    setShowJumpToLatest(false);
    queueAutoScroll('bottom', 'jumpToLatest', { userInitiated: true });
    logChatDebug('jumpToLatest', {
      conversationId: activeConversationIdRef.current,
    });
    let iterations = 0;
    while (messagesHasNewerRef.current && iterations < 12) {
      if (!activeConversationIdRef.current) break;
      const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
      const newerItems = await loadMessages(activeConversationIdRef.current, {
        ...requestOptions,
        reason: requestOptions.afterMessageId ? 'jumpToLatest:loadNewer' : 'jumpToLatest:bootstrap',
      });
      if (!Array.isArray(newerItems) || newerItems.length === 0) break;
      iterations += 1;
    }
    scrollThreadBottomIntoView({ source: 'jumpToLatest:bottomRef', behavior: 'smooth' });
  }, [
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    loadMessages,
    logChatDebug,
    messagesHasNewerRef,
    messagesRef,
    queueAutoScroll,
    scrollThreadBottomIntoView,
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
  ]);

  return {
    handleThreadScroll,
    jumpToLatest,
  };
}

import { useCallback } from 'react';

export default function useChatThreadInteractionController({
  activeConversationIdRef,
  cancelPendingInitialAnchor,
  clearInitialViewportGuard,
  isInitialViewportGuardActive,
  loadMessages,
  logChatDebug,
  messagesHasNewerRef,
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

  // R26/R28: replacing the partial window with a single bootstrap (no anchor)
  // is the Telegram strategy — one request instead of walking pages, and the
  // response itself carries the fresh cursor/has_newer, so no identical
  // re-requests are possible.
  const loadLatestThreadWindow = useCallback(async (reason = 'latestWindow') => {
    if (!messagesHasNewerRef.current) return false;
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return false;
    await loadMessages(conversationId, {
      silent: true,
      force: true,
      reason: `${reason}:bootstrap`,
    });
    return true;
  }, [activeConversationIdRef, loadMessages, messagesHasNewerRef]);

  // R20/R26: an own send while a partial window is loaded (has_newer) must
  // first load the latest window — then the viewport is scrolled to the very
  // bottom like jumpToLatest, so the outgoing bubble is visible.
  const ensureLatestThreadWindow = useCallback(async () => {
    if (!messagesHasNewerRef.current) return;
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return;
    logChatDebug('ensureLatestThreadWindow', { conversationId });
    cancelPendingInitialAnchor();
    threadNearBottomRef.current = true;
    showJumpToLatestRef.current = false;
    setShowJumpToLatest(false);
    queueAutoScroll('bottom', 'ensureLatestThreadWindow');
    await loadLatestThreadWindow('outgoingSend');
    scrollThreadBottomIntoView({ source: 'ensureLatestThreadWindow:bottom', behavior: 'instant' });
  }, [
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    loadLatestThreadWindow,
    logChatDebug,
    messagesHasNewerRef,
    queueAutoScroll,
    scrollThreadBottomIntoView,
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
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
    await loadLatestThreadWindow('jumpToLatest');
    scrollThreadBottomIntoView({ source: 'jumpToLatest:bottomRef', behavior: 'smooth' });
  }, [
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    loadLatestThreadWindow,
    logChatDebug,
    queueAutoScroll,
    scrollThreadBottomIntoView,
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
  ]);

  return {
    ensureLatestThreadWindow,
    handleThreadScroll,
    jumpToLatest,
  };
}

import { useCallback } from 'react';

import useChatAnchorController from './useChatAnchorController';
import useChatScrollController from './useChatScrollController';
import useChatThreadInteractionController from './useChatThreadInteractionController';
import useChatMessageScrollHighlight from './useChatMessageScrollHighlight';
import { resolveActiveThreadTransportState } from './chatThreadTransport';
import useChatDebugController from './useChatDebugController';

export default function useChatPageAnchorScrollBridge({
  activeConversationId,
  refs,
  logChatDebugRef,
  degradedThreadRevalidateCountRef,
  initialViewportGuardRef,
  lastSocketActivityAtRef,
  socketStatusRef,
  threadScrollRef,
  conversationsRef,
  messagesRef,
  pendingInitialAnchorRef,
  prependScrollRestoreRef,
  setShowJumpToLatest,
  viewerLastReadMessageId,
  cancelPendingInitialAnchorRef,
  queueInitialThreadPositionRef,
  capturePrependScrollRestoreRef,
  resolvePendingInitialAnchorFromPayloadRef,
  hasPendingInitialAnchorForConversationRef,
  isInitialViewportGuardActiveRef,
  anchorGuardBridgeRef,
  scrollThreadBottomIntoViewRef,
  scrollToMessageRef,
  highlightResetTimeoutRef,
  setHighlightedMessageId,
  loadMessages,
  messagesHasNewerRef,
  queueAutoScroll,
  suppressThreadScrollCancelRef,
  threadNearBottomRef,
}) {
  const {
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    bottomInstantSettleFrameRef,
    bottomRef,
    chatDebugSeqRef,
    mobileKeyboardSettleTimeoutsRef,
    pinnedScrollRef,
    showJumpToLatestRef,
    threadContentRef,
    threadViewportSyncFrameRef,
  } = refs;

  const { logChatDebug } = useChatDebugController({
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    chatDebugSeqRef,
    degradedThreadRevalidateCountRef,
    initialViewportGuardRef,
    lastSocketActivityAtRef,
    logChatDebugRef,
    pendingInitialAnchorRef,
    resolveActiveThreadTransportState,
    socketStatusRef,
    threadScrollRef,
  });

  const suppressThreadScrollCancel = useCallback(() => {
    suppressThreadScrollCancelRef.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        suppressThreadScrollCancelRef.current = false;
      });
    });
  }, [suppressThreadScrollCancelRef]);

  const {
    scheduleThreadViewportStateSync,
    syncThreadViewportState,
    setThreadScrollTop,
    bindPinnedScroll,
    scrollThreadToBottomInstant,
    clearMobileKeyboardSettleTimeouts,
    scheduleMobileKeyboardBottomSettle,
    scrollThreadBottomIntoView,
    capturePrependScrollRestore,
  } = useChatScrollController({
    activeConversationIdRef,
    bottomInstantSettleFrameRef,
    bottomRef,
    isInitialViewportGuardActive: (...args) => anchorGuardBridgeRef.current.isInitialViewportGuardActive(...args),
    mobileKeyboardSettleTimeoutsRef,
    pinnedScrollRef,
    setShowJumpToLatest,
    showJumpToLatestRef,
    suppressThreadScrollCancel,
    threadNearBottomRef,
    threadScrollRef,
    threadViewportSyncFrameRef,
    traceProgrammaticThreadScroll: (...args) => anchorGuardBridgeRef.current.traceProgrammaticThreadScroll(...args),
  });

  const {
    applyPendingInitialAnchor,
    cancelPendingInitialAnchor,
    clearInitialViewportGuard,
    hasPendingInitialAnchorForConversation,
    isInitialViewportGuardActive,
    queueInitialThreadPosition,
    resolvePendingInitialAnchorFromPayload,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    traceProgrammaticThreadScroll,
  } = useChatAnchorController({
    activeConversationId,
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    conversationsRef,
    initialViewportGuardRef,
    logChatDebug,
    messagesRef,
    pendingInitialAnchorRef,
    prependScrollRestoreRef,
    setShowJumpToLatest,
    setThreadScrollTop,
    showJumpToLatestRef,
    syncThreadViewportState,
    threadContentRef,
    threadNearBottomRef,
    threadScrollRef,
    viewerLastReadMessageId,
  });

  anchorGuardBridgeRef.current = {
    isInitialViewportGuardActive,
    traceProgrammaticThreadScroll,
  };
  cancelPendingInitialAnchorRef.current = cancelPendingInitialAnchor;
  queueInitialThreadPositionRef.current = queueInitialThreadPosition;
  capturePrependScrollRestoreRef.current = capturePrependScrollRestore;
  resolvePendingInitialAnchorFromPayloadRef.current = resolvePendingInitialAnchorFromPayload;
  hasPendingInitialAnchorForConversationRef.current = hasPendingInitialAnchorForConversation;
  isInitialViewportGuardActiveRef.current = isInitialViewportGuardActive;

  const {
    handleThreadScroll,
    jumpToLatest,
  } = useChatThreadInteractionController({
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
  });

  const {
    emitChatUnreadRefresh,
    scrollToMessage,
  } = useChatMessageScrollHighlight({
    cancelPendingInitialAnchor,
    highlightResetTimeoutRef,
    scrollToMessageRef,
    setHighlightedMessageId,
    threadScrollRef,
    traceProgrammaticThreadScroll,
  });

  scrollThreadBottomIntoViewRef.current = scrollThreadBottomIntoView;

  return {
    logChatDebug,
    bindPinnedScroll,
    scrollThreadToBottomInstant,
    clearMobileKeyboardSettleTimeouts,
    scheduleMobileKeyboardBottomSettle,
    scrollThreadBottomIntoView,
    applyPendingInitialAnchor,
    cancelPendingInitialAnchor,
    clearInitialViewportGuard,
    hasPendingInitialAnchorForConversation,
    resolvePendingInitialAnchorFromPayload,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    handleThreadScroll,
    jumpToLatest,
    emitChatUnreadRefresh,
    scrollToMessage,
  };
}

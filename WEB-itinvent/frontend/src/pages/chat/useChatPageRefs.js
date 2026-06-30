import { useRef } from 'react';

export default function useChatPageRefs({
  canUseAiChat,
  initialAiBotsCache,
  initialConversationId,
  initialConversationsCache,
  initialThreadCache,
}) {
  const composerRef = useRef(null);
  const bottomRef = useRef(null);
  const sidebarScrollRef = useRef(null);
  const threadScrollRef = useRef(null);
  const pinnedScrollRef = useRef(null);
  const threadContentRef = useRef(null);
  const autoScrollRef = useRef(false);
  const autoScrollMetaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaFileInputRef = useRef(null);
  const composerSelectionRef = useRef({ start: null, end: null });
  const invalidConversationRef = useRef('');
  const activeConversationIdRef = useRef('');
  const conversationsRef = useRef([]);
  const conversationDetailsByIdRef = useRef({});
  const requestedConversationHandledRef = useRef('');
  const requestedConversationRetryRef = useRef('');
  const applyingRequestedConversationRef = useRef('');
  const requestedMessageRevealKeyRef = useRef('');
  const conversationsRequestSeqRef = useRef(0);
  const conversationsLoadingRequestSeqRef = useRef(0);
  const conversationsLoadingRef = useRef(true);
  const threadNearBottomRef = useRef(true);
  const threadViewportSyncFrameRef = useRef(null);
  const bottomInstantSettleFrameRef = useRef(null);
  const mobileKeyboardSettleTimeoutsRef = useRef([]);
  const prependScrollRestoreRef = useRef(null);
  const loadOlderInFlightCursorRef = useRef('');
  const highlightResetTimeoutRef = useRef(null);
  const suppressDraftSyncRef = useRef(false);
  const revealMessageRef = useRef(null);
  const loadMessagesRef = useRef(null);
  const markConversationReadLiveRef = useRef(null);
  const focusComposerRef = useRef(null);
  const shareComposeDraftRef = useRef(null);
  const queueInitialThreadPositionRef = useRef(null);
  const cancelPendingInitialAnchorRef = useRef(null);
  const lastForegroundRefreshAtRef = useRef(0);
  const logChatDebugRef = useRef(null);
  const latestActiveThreadSocketMessageRef = useRef(null);
  const degradedThreadRevalidateCountRef = useRef(0);
  const showJumpToLatestRef = useRef(false);
  const loadConversationsRef = useRef(null);
  const openMobileThreadViewRef = useRef(null);
  const aiRunStartedAtByConversationRef = useRef({});
  const pendingInitialAnchorRef = useRef(null);
  const suppressThreadScrollCancelRef = useRef(false);
  const chatDebugSeqRef = useRef(0);
  const optimisticMessageSeqRef = useRef(0);
  const draftWriteTimeoutRef = useRef(null);
  const latestDraftStorageKeyRef = useRef('');
  const latestMessageTextRef = useRef('');
  const threadLoadAbortRef = useRef(null);
  const threadPrefetchAbortControllersRef = useRef(new Map());
  const resolvePendingInitialAnchorFromPayloadRef = useRef(null);
  const hasPendingInitialAnchorForConversationRef = useRef(null);
  const isInitialViewportGuardActiveRef = useRef(null);
  const capturePrependScrollRestoreRef = useRef(null);
  const syncConversationPreviewRef = useRef(null);
  const scrollThreadBottomIntoViewRef = useRef(null);
  const scrollToMessageRef = useRef(null);
  const skippedInitialSocketRefreshRef = useRef(false);
  const skippedInitialSnapshotRefreshRef = useRef(false);
  const lastConversationsLoadAtRef = useRef(0);
  const conversationsCacheHydratedRef = useRef(Boolean(initialConversationsCache?.data));
  const aiBotsCacheHydratedRef = useRef(Boolean(initialAiBotsCache?.data));
  const aiBotsRequestSeqRef = useRef(0);
  const aiBotsLoadingRequestSeqRef = useRef(0);
  const aiBotsLoadingRef = useRef(canUseAiChat ? !initialAiBotsCache?.data : false);
  const hydratedThreadConversationIdRef = useRef(initialThreadCache?.data ? initialConversationId : '');
  const mobileHistoryReadyRef = useRef(false);
  const mobileHistoryModeRef = useRef('inbox');
  const lastHandledThreadLayoutKeyRef = useRef('');
  const initialViewportGuardRef = useRef(null);
  const anchorGuardBridgeRef = useRef({
    isInitialViewportGuardActive: () => false,
    traceProgrammaticThreadScroll: () => {},
  });
  const mobileNavRef = useRef({});

  return {
    activeConversationIdRef,
    aiBotsCacheHydratedRef,
    aiBotsLoadingRef,
    aiBotsLoadingRequestSeqRef,
    aiBotsRequestSeqRef,
    aiRunStartedAtByConversationRef,
    anchorGuardBridgeRef,
    applyingRequestedConversationRef,
    autoScrollMetaRef,
    autoScrollRef,
    bottomInstantSettleFrameRef,
    bottomRef,
    cancelPendingInitialAnchorRef,
    capturePrependScrollRestoreRef,
    chatDebugSeqRef,
    composerRef,
    composerSelectionRef,
    conversationDetailsByIdRef,
    conversationsCacheHydratedRef,
    conversationsLoadingRef,
    conversationsLoadingRequestSeqRef,
    conversationsRef,
    conversationsRequestSeqRef,
    degradedThreadRevalidateCountRef,
    draftWriteTimeoutRef,
    fileInputRef,
    focusComposerRef,
    hasPendingInitialAnchorForConversationRef,
    highlightResetTimeoutRef,
    hydratedThreadConversationIdRef,
    initialViewportGuardRef,
    invalidConversationRef,
    isInitialViewportGuardActiveRef,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    lastHandledThreadLayoutKeyRef,
    latestActiveThreadSocketMessageRef,
    latestDraftStorageKeyRef,
    latestMessageTextRef,
    loadConversationsRef,
    loadMessagesRef,
    loadOlderInFlightCursorRef,
    logChatDebugRef,
    markConversationReadLiveRef,
    mediaFileInputRef,
    mobileHistoryModeRef,
    mobileHistoryReadyRef,
    mobileKeyboardSettleTimeoutsRef,
    mobileNavRef,
    openMobileThreadViewRef,
    optimisticMessageSeqRef,
    pendingInitialAnchorRef,
    pinnedScrollRef,
    prependScrollRestoreRef,
    queueInitialThreadPositionRef,
    requestedConversationHandledRef,
    requestedConversationRetryRef,
    requestedMessageRevealKeyRef,
    resolvePendingInitialAnchorFromPayloadRef,
    revealMessageRef,
    scrollThreadBottomIntoViewRef,
    scrollToMessageRef,
    shareComposeDraftRef,
    showJumpToLatestRef,
    sidebarScrollRef,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    suppressDraftSyncRef,
    suppressThreadScrollCancelRef,
    syncConversationPreviewRef,
    threadContentRef,
    threadLoadAbortRef,
    threadNearBottomRef,
    threadPrefetchAbortControllersRef,
    threadScrollRef,
    threadViewportSyncFrameRef,
  };
}

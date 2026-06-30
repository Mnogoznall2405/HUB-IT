import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Stack } from '@mui/material';

import useReadReceipts from '../../components/chat/useReadReceipts';
import useChatSidebarSearch from '../../components/chat/useChatSidebarSearch';
import useChatTaskSharing from '../../components/chat/useChatTaskSharing';
import useChatPageComposerStack from './useChatPageComposerStack';
import useChatPageAnchorScrollBridge from './useChatPageAnchorScrollBridge';
import useChatPageOverlayDialogs from './useChatPageOverlayDialogs';
import useChatMobileNavigation from './useChatMobileNavigation';
import {
  loadChatDialogsModule,
  useChatDialogsController,
  useChatSocketController,
} from './useChatPageController';
import useChatPagePanelsBridge, { useChatPageBrowserConversationId } from './useChatPagePanelsBridge';
import ChatPageConversationActionDialog from './ChatPageConversationActionDialog';
import ChatPageDesktopLayout from './ChatPageDesktopLayout';
import ChatPageDialogsLayer from './ChatPageDialogsLayer';
import ChatPageFolderDialogsSection from './ChatPageFolderDialogsSection';
import ChatPageMessageChrome from './ChatPageMessageChrome';
import useChatMessageActionsController from './useChatMessageActionsController';
import useChatGroupActionsController from './useChatGroupActionsController';
import useChatReadReceiptsBridge from './useChatReadReceiptsBridge';
import useChatReactionAndPinController from './useChatReactionAndPinController';
import useChatNavigationController from './useChatNavigationController';
import useChatConversationActionsController from './useChatConversationActionsController';
import useChatAutoScrollLayoutEffect from './useChatAutoScrollLayoutEffect';
import useChatNotesConversationBootstrap from './useChatNotesConversationBootstrap';
import useChatUrlConversationBootstrap from './useChatUrlConversationBootstrap';
import useChatActiveConversationThreadBootstrap from './useChatActiveConversationThreadBootstrap';
import useChatActiveConversationSurfaceEffects, {
  buildPinnedMessagePayloadFromMessage,
} from './useChatActiveConversationSurfaceEffects';
import useChatConversationDraftRestore from './useChatConversationDraftRestore';
import useChatActiveConversationLifecycleEffects from './useChatActiveConversationLifecycleEffects';
import useChatSessionPersistenceEffects from './useChatSessionPersistenceEffects';
import useChatMobileViewGuardEffects from './useChatMobileViewGuardEffects';
import useChatComposePrefillBootstrap from './useChatComposePrefillBootstrap';
import useChatContextPanelDetailPrefetch from './useChatContextPanelDetailPrefetch';
import useChatPageBootEffects from './useChatPageBootEffects';
import useChatOptimisticThreadMessages from './useChatOptimisticThreadMessages';
import useChatThreadMessageMerge from './useChatThreadMessageMerge';
import { buildChatThreadWallpaperSx } from './chatThreadWallpaper';
import useChatThreadHeaderPresentation from './useChatThreadHeaderPresentation';
import useChatMobileBottomNavEffects from './useChatMobileBottomNavEffects';
import useChatMobileThreadAnimation from './useChatMobileThreadAnimation';
import useChatMountCleanupEffects from './useChatMountCleanupEffects';
import useChatConversationSyncCallbacks from './useChatConversationSyncCallbacks';
import useChatRevealMessage from './useChatRevealMessage';
import useChatHealthBootstrap from './useChatHealthBootstrap';
import useChatThreadPrefetch from './useChatThreadPrefetch';
import useChatComposerSelection from './useChatComposerSelection';
import useChatMarkReadLive from './useChatMarkReadLive';
import useChatActiveConversation from './useChatActiveConversation';
import useChatAiPresentation from './useChatAiPresentation';
import useChatConversationDetailService from './useChatConversationDetailService';
import useChatSidebarDerivedState from './useChatSidebarDerivedState';
import useChatMessageSelection from './useChatMessageSelection';
import useChatBottomInstantFrameCleanup from './useChatBottomInstantFrameCleanup';
import ChatShellLayout from './ChatShellLayout';
import { shouldShowOlderHistoryControl } from './chatThreadHistory';
import { getTaskConversationTaskId } from './chatConversationModel';
import {
  CHAT_MOBILE_SCREEN_TRANSITION_MS,
  buildChatMobileScreenVariants,
  resolveChatMobileBottomNavMode,
} from './chatMobileModel';
import {
  buildChatMobileScreenTransition,
  resolveChatMobileView,
} from './chatMobilePresentation';
import {
  CHAT_SEARCH_DEBOUNCE_MS,
  CHAT_SWR_STALE_TIME_MS,
  CHAT_THREAD_POLL_MS,
} from './chatPageConstants';
import useChatPageInitialState from './useChatPageInitialState';
import useChatPageCoreBridge from './useChatPageCoreBridge';
import useChatPageLayoutInputs from './useChatPageLayoutInputs';
import useChatPageLayoutContext from './useChatPageLayoutContext';
import { pickChatPageLayoutSections } from './pickChatPageLayoutSections';
import useChatMessageChromeController from './useChatMessageChromeController';
import useChatPageRealtimeEffects from './useChatPageRealtimeEffects';
import { syncChatPageCollectionRefs } from './syncChatPageCollectionRefs';

export function ChatPageContent() {
  const pageState = useChatPageInitialState();
  const {
    theme,
    ui,
    isMobile,
    isPhone,
    isWideDesktop,
    mobileMotionDisabled,
    navigate,
    location,
    user,
    canUseAiChat,
    notifyApiError,
    notifyInfo,
    notifyWarning,
    closeDrawer,
    userCacheId,
    requestedConversationId,
    requestedMessageId,
    composePrefillRequested,
    lastConversationSessionKey,
    lastMobileViewSessionKey,
    restoredConversationId,
    restoredMobileView,
    initialConversationId,
    conversationsCacheKeyParts,
    initialThreadCache,
    aiBotsCacheKeyParts,
    refs,
    health,
    healthError,
    setHealth,
    setHealthError,
    conversations,
    setConversations,
    conversationDetailsById,
    setConversationDetailsById,
    conversationsLoading,
    setConversationsLoading,
    conversationBootstrapComplete,
    setConversationBootstrapComplete,
    conversationFilter,
    setConversationFilter,
    customFolders,
    setCustomFolders,
    conversationIdsByFolder,
    setConversationIdsByFolder,
    foldersLoading,
    setFoldersLoading,
    folderManagerOpen,
    setFolderManagerOpen,
    folderManagerCreateMode,
    setFolderManagerCreateMode,
    folderSaving,
    setFolderSaving,
    aiBots,
    setAiBots,
    aiBotsLoading,
    setAiBotsLoading,
    aiBotsError,
    setAiBotsError,
    openingAiBotId,
    setOpeningAiBotId,
    aiStatusByConversation,
    setAiStatusByConversation,
    activeConversationId,
    setActiveConversationId,
    mobileView,
    setMobileView,
    mobileTransitionDirection,
    setMobileTransitionDirection,
    setMobileBottomNavHidden,
    messageText,
    setMessageText,
    pinnedMessage,
    setPinnedMessage,
    showJumpToLatest,
    setShowJumpToLatest,
  } = pageState;

  const {
    activeConversationIdRef,
    aiBotsCacheHydratedRef,
    aiBotsLoadingRef,
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
    conversationsRef,
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
  } = refs;

  const {
    patchSearchConversations,
    patchSearchPersonPresence,
    resetSidebarSearch,
    searchChats,
    searchPeople,
    searchResultEmpty,
    searchingSidebar,
    setSidebarQuery,
    sidebarQuery,
    sidebarSearchActive,
    upsertSearchConversation,
  } = useChatSidebarSearch({
    notifyApiError,
    searchDebounceMs: CHAT_SEARCH_DEBOUNCE_MS,
  });

  const core = useChatPageCoreBridge({
    activeConversationId,
    refs,
    initialConversationId,
    initialThreadCache,
    conversationsCacheKeyParts,
    userCacheId,
    notifyApiError,
    setConversations,
    setConversationsLoading,
    setCustomFolders,
    setConversationIdsByFolder,
    setFoldersLoading,
    setConversationFilter,
    canUseAiChat,
    aiBotsCacheKeyParts,
    setAiBots,
    setAiBotsLoading,
    setAiBotsError,
    setAiStatusByConversation,
    user,
    messageText,
    pinnedMessage,
    setPinnedMessage,
    conversationFilter,
    customFolders,
    setFolderManagerCreateMode,
    setFolderManagerOpen,
    setFolderSaving,
  });

  const {
    loadConversations,
    handleSidebarScroll,
    handleCreateChatFolder,
    handleDeleteChatFolder,
    handleOpenFolderManager,
    handleRemoveConversationFromFolder,
    handleRenameChatFolder,
    handleReorderChatFolder,
    handleToggleConversationInFolder,
    loadAiBots,
    draftStorageKey,
    pinnedMessageStorageKey,
    persistPinnedMessageToStorage,
    messages,
    setMessages,
    messagesRef,
    messagesLoading,
    setMessagesLoading,
    messagesLoadingRef,
    messagesHasMore,
    setMessagesHasMore,
    messagesHasMoreRef,
    messagesHasNewer,
    setMessagesHasNewer,
    messagesHasNewerRef,
    olderHistoryUnavailable,
    setOlderHistoryUnavailable,
    olderHistoryExhaustedRef,
    loadingOlder,
    setLoadingOlder,
    viewerLastReadMessageId,
    setViewerLastReadMessageId,
    viewerLastReadAt,
    setViewerLastReadAt,
    applyLatestThreadPayload,
    loadThreadBootstrap,
    loadMessages,
    loadOlderMessages,
    queueAutoScroll,
  } = core;

  const overlays = useChatPageOverlayDialogs({
    isMobile,
    activeConversationId,
    activeConversationIdRef,
    loadConversationsRef,
    notifyApiError,
    notifyInfo,
    openMobileThreadViewRef,
    revealMessageRef,
    setActiveConversationId,
  });

  const {
    replyMessage, setReplyMessage, editingMessage, setEditingMessage,
    addGroupMember, closeGroupDialog, createGroup, creatingConversation, groupCreateDisabled,
    groupMemberIds, groupOpen, groupSearch, groupSelectedUsers, groupTitle, groupUsers, groupUsersLoading,
    openGroupDialog, patchGroupPresence, removeGroupMember, setGroupSearch, setGroupTitle,
    openingPeerId, setOpeningPeerId,
    threadMenuAnchor, setThreadMenuAnchor, messageMenuAnchor, setMessageMenuAnchor,
    messageMenuMessage, setMessageMenuMessage, composerMenuAnchor, setComposerMenuAnchor,
    openShareDialog, resetShareDialog, setSharingTaskId, setTaskSearch, shareOpen, shareableLoading,
    shareableTasks, sharingTaskId, taskSearch,
    selectedMessageIds, setSelectedMessageIds, emojiAnchorEl, setEmojiAnchorEl,
    messageReadsOpen, setMessageReadsOpen, messageReadsLoading, setMessageReadsLoading,
    messageReadsItems, setMessageReadsItems, messageReadsMessage, setMessageReadsMessage,
    closeSearchDialog, loadMoreSearchResults, messageSearch, messageSearchHasMore, messageSearchLoading,
    messageSearchResults, openSearchDialog, openSearchResult, resetMessageSearch, searchOpen, setMessageSearch,
  } = overlays;
  const {
    canCopySelectedMessages,
    selectedMessageCount,
    selectedMessages,
    selectedVisibleMessageIds,
  } = useChatMessageSelection({
    messages,
    selectedMessageIds,
  });
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const deferredMessageText = useDeferredValue(messageText);

  useChatBottomInstantFrameCleanup({ bottomInstantSettleFrameRef });

  const {
    activeConversation,
    mentionCandidates,
    searchMentionPeople,
  } = useChatActiveConversation({
    activeConversationId,
    conversationDetailsById,
    conversations,
    searchChats,
    searchPeople,
    userId: user?.id,
  });

  const {
    activeAiLiveDataNotice,
    activeAiStatus,
    activeAiStatusDisplay,
    aiTypingStatus,
    setOptimisticAiQueuedStatus,
  } = useChatAiPresentation({
    activeConversationId,
    activeConversationKind: activeConversation?.kind,
    aiBots,
    aiStatusByConversation,
    setAiStatusByConversation,
  });

  const {
    clearStoredConversationState,
    loadConversationDetail,
    upsertConversationDetail,
  } = useChatConversationDetailService({
    conversationDetailsByIdRef,
    lastConversationSessionKey,
    lastMobileViewSessionKey,
    setConversationDetailsById,
    userCacheId,
  });

  const {
    aiSidebarRows,
    conversationFilterCounts,
    draftsByConversation,
    filteredConversations,
    unreadTotal,
    watchedPresenceUserIds,
    watchedPresenceUserIdsKey,
  } = useChatSidebarDerivedState({
    activeConversation,
    activeConversationId,
    aiBots,
    conversationFilter,
    conversationIdsByFolder,
    conversations,
    customFolders,
    deferredMessageText,
    groupSelectedUsers,
    groupUsers,
    messageReadsItems,
    searchChats,
    searchPeople,
    userId: user?.id,
  });

  const {
    activeThreadTransportState,
    lastSocketActivityAtRef,
    markSocketActivity,
    setSocketStatus,
    setTypingUsers,
    socketStatus,
    socketStatusRef,
    typingLine,
    typingParticipantsTimeoutsRef,
    typingUsers,
  } = useChatSocketController({
    activeConversationId,
    deferredMessageText,
    logChatDebugRef,
    watchedPresenceUserIds,
    watchedPresenceUserIdsKey,
  });

  const activeTaskConversationTaskId = getTaskConversationTaskId(activeConversation);

  const getCurrentBrowserConversationId = useChatPageBrowserConversationId();

  const {
    attachmentPreview,
    closeAttachmentPreview,
    closeDocumentPreview,
    documentPreview,
    handleDownloadDocumentPreview,
    handleDownloadDocumentPreviewPdf,
    openMediaViewer,
    closeAllPanels,
    closeInfoAndContextPanels,
    closeMobileInfoView,
    closeTaskPanel,
    contextPanelEnterDuration,
    contextPanelExitDuration,
    contextPanelOpen,
    handleOpenInfo,
    handleTaskPanelUpdated,
    infoOpen,
    openTaskFromChat,
    openTaskInTasks,
    renderDesktopRightPanel,
    renderPersistentRightPanel,
    setContextPanelOpen,
    setInfoOpen,
    showContextPanel,
    showTaskPanel,
    taskPanelTaskId,
  } = useChatPagePanelsBridge({
    activeConversation,
    activeConversationIdRef,
    activeTaskConversationTaskId,
    getCurrentBrowserConversationId,
    mobileNavRef,
    isMobile,
    isWideDesktop,
    prefersReducedMotion: pageState.prefersReducedMotion,
    loadConversationDetail,
    loadConversationsRef,
    mobileHistoryReadyRef,
    setConversations,
    setConversationDetailsById,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
    userId: user?.id,
    messagesRef,
    notifyApiError,
  });

  const mobileScreenTransition = buildChatMobileScreenTransition(mobileMotionDisabled);
  const resolvedMobileView = resolveChatMobileView({
    isMobile,
    mobileView,
    activeConversationId,
    conversationBootstrapComplete,
    activeConversation,
    messagesLoading,
    requestedConversationId,
  });

  const {
    getMobileHistoryKey,
    openMobileInboxView,
    openMobileThreadView,
    readMobileHistoryState,
    writeMobileHistoryState,
  } = useChatMobileNavigation({
    isMobile,
    activeConversationId,
    activeConversationIdRef,
    closeDrawer,
    conversationsStaleTimeMs: CHAT_SWR_STALE_TIME_MS,
    getCurrentBrowserConversationId,
    infoOpen,
    lastConversationsLoadAtRef,
    loadConversations,
    locationHash: location.hash,
    locationPathname: location.pathname,
    locationSearch: location.search,
    mobileHistoryModeRef,
    mobileHistoryReadyRef,
    openMobileThreadViewRef,
    requestedConversationId,
    requestedMessageId,
    resolvedMobileView,
    setActiveConversationId,
    setInfoOpen,
    setMobileBottomNavHidden,
    setMobileTransitionDirection,
    setMobileView,
  });

  mobileNavRef.current = {
    getMobileHistoryKey,
    readMobileHistoryState,
    writeMobileHistoryState,
  };

  useChatMobileBottomNavEffects({
    isMobile,
    mobileMotionDisabled,
    resolvedMobileView,
    setMobileBottomNavHidden,
  });

  const handleMobileThreadScreenAnimationComplete = useChatMobileThreadAnimation({
    isMobile,
    mobileMotionDisabled,
    resolvedMobileView,
    setMobileBottomNavHidden,
  });

  const threadWallpaperSx = useMemo(
    () => buildChatThreadWallpaperSx(theme, ui),
    [theme, ui],
  );

  const {
    aiAwareTypingLine,
    conversationMetaSubtitle,
  } = useChatThreadHeaderPresentation({
    activeConversation,
    activeAiStatusDisplay,
    typingLine,
    typingUsers,
  });

  const persistPinnedMessage = useCallback((nextPinnedMessage) => {
    setPinnedMessage(nextPinnedMessage || null);
    persistPinnedMessageToStorage(nextPinnedMessage || null);
  }, [persistPinnedMessageToStorage, setPinnedMessage]);

  const anchorScroll = useChatPageAnchorScrollBridge({
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
  });

  const {
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
  } = anchorScroll;

  const buildPinnedMessagePayload = buildPinnedMessagePayloadFromMessage;

  syncChatPageCollectionRefs({
    conversationsRef,
    conversations,
    conversationDetailsByIdRef,
    conversationDetailsById,
    conversationsLoadingRef,
    conversationsLoading,
    aiBotsLoadingRef,
    aiBotsLoading,
  });

  useChatSessionPersistenceEffects({
    activeConversationId,
    aiBots,
    aiBotsCacheHydratedRef,
    aiBotsCacheKeyParts,
    canUseAiChat,
    conversations,
    conversationsCacheHydratedRef,
    conversationsCacheKeyParts,
    hydratedThreadConversationIdRef,
    lastConversationSessionKey,
    lastMobileViewSessionKey,
    messages,
    messagesHasMore,
    messagesHasNewer,
    mobileView,
    userCacheId,
    viewerLastReadAt,
    viewerLastReadMessageId,
  });

  useChatMountCleanupEffects({
    highlightResetTimeoutRef,
    threadViewportSyncFrameRef,
  });

  const focusComposer = useCallback((options = {}) => {
    const forceMobile = Boolean(options?.forceMobile);
    if (isMobile && !forceMobile) return;
    window.requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node?.focus) return;
      if (typeof document !== 'undefined' && document.activeElement === node) return;
      try {
        node.focus({ preventScroll: true });
      } catch {
        node.focus();
      }
    });
  }, [composerRef, isMobile]);
  focusComposerRef.current = focusComposer;

  const {
    applyMessageReadDelta,
    patchThreadMessage,
    promoteConversationToTop,
    syncConversationPreview,
    syncConversationUnreadState,
    updatePresenceInCollections,
    upsertConversation,
  } = useChatConversationSyncCallbacks({
    messagesRef,
    patchGroupPresence,
    patchSearchConversations,
    patchSearchPersonPresence,
    setConversationDetailsById,
    setConversations,
    setMessageReadsItems,
    setMessages,
    upsertSearchConversation,
  });
  syncConversationPreviewRef.current = syncConversationPreview;

  const {
    buildReplyPreview,
    createOptimisticFileMessage,
    createOptimisticTextMessage,
    isLikelyOptimisticReplacement,
    revokeObjectUrls,
    withStableMessageRenderKey,
  } = useChatOptimisticThreadMessages({
    optimisticMessageSeqRef,
    user,
  });

  const {
    applyOutgoingThreadMessage,
    mergeMessageIntoThread,
    removeThreadMessage,
    upsertThreadMessages,
  } = useChatThreadMessageMerge({
    activeConversationIdRef,
    isLikelyOptimisticReplacement,
    messagesRef,
    promoteConversationToTop,
    queueAutoScroll,
    setMessages,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    syncConversationPreview,
    withStableMessageRenderKey,
  });

  const { insertEmojiAtSelection, syncComposerSelection } = useChatComposerSelection({
    composerRef,
    composerSelectionRef,
    isMobile,
    messageText,
    setEmojiAnchorEl,
    setMessageText,
  });

  const { markConversationReadLive } = useChatMarkReadLive({
    activeConversationIdRef,
    emitChatUnreadRefresh,
    markConversationReadLiveRef,
    messagesRef,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    syncConversationUnreadState,
  });

  useChatHealthBootstrap({
    setHealth,
    setHealthError,
  });

  const { prefetchAdjacentThreadBootstraps, prefetchThreadBootstrap } = useChatThreadPrefetch({
    conversationsRef,
    staleTimeMs: CHAT_SWR_STALE_TIME_MS,
    threadPrefetchAbortControllersRef,
    userCacheId,
  });

  const {
    handleOptimisticRead,
    handleReadReceiptsSyncError,
    openMessageReads,
  } = useChatReadReceiptsBridge({
    activeConversationIdRef,
    loadChatDialogsModule,
    loadConversations,
    loadMessages,
    notifyApiError,
    setMessageReadsItems,
    setMessageReadsLoading,
    setMessageReadsMessage,
    setMessageReadsOpen,
    sidebarSearchActive,
    syncConversationUnreadState,
  });

  const {
    effectiveLastReadMessageId,
    getReadTargetRef,
  } = useReadReceipts({
    conversationId: activeConversationId,
    messages,
    enabled: Boolean(activeConversationId && !messagesLoading),
    scrollRootRef: threadScrollRef,
    viewerLastReadMessageId,
    markRead: markConversationReadLive,
    onOptimisticRead: handleOptimisticRead,
    onReadSyncError: handleReadReceiptsSyncError,
  });

  const { revealMessage } = useChatRevealMessage({
    activeConversationIdRef,
    loadMessages,
    messagesHasMoreRef,
    messagesRef,
    revealMessageRef,
    scrollToMessage,
  });

  const {
    handleOpenPinnedMessage,
    handleToggleReaction,
    handleUnpinPinnedMessage,
  } = useChatReactionAndPinController({
    activeConversationIdRef,
    notifyApiError,
    notifyInfo,
    persistPinnedMessage,
    pinnedMessage,
    revealMessage,
    setMessages,
  });

  const {
    handleAddGroupMembers,
    handleLeaveGroup,
    handleRemoteConversationRemoved,
    handleRemoveGroupMember,
    handleTransferGroupOwnership,
    handleUpdateGroupMemberRole,
    handleUpdateGroupProfile,
  } = useChatGroupActionsController({
    activeConversationIdRef,
    clearStoredConversationState,
    closeAllPanels,
    closeInfoAndContextPanels,
    isMobile,
    notifyApiError,
    openMobileInboxView,
    setActiveConversationId,
    setConversationDetailsById,
    setConversations,
    setMessages,
    setMessagesHasMore,
    setMessagesHasNewer,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    upsertConversationDetail,
    upsertSearchConversation,
  });

  const {
    closeConversationAction,
    confirmConversationAction,
    conversationActionConversation,
    conversationActionId,
    conversationActionIsLeave,
    conversationActionPendingId,
    conversationActionTarget,
    conversationActionTitle,
    requestConversationRemoval,
    requestDeleteConversation,
    requestLeaveConversation,
    settingsUpdating,
    updateConversationSettings,
  } = useChatConversationActionsController({
    activeConversationId,
    handleRemoteConversationRemoved,
    notifyApiError,
    notifyInfo,
    setConversations,
    upsertSearchConversation,
  });

  useChatPageBootEffects({
    loadConversations,
    loadChatFolders: core.loadChatFolders,
    loadAiBots,
    logChatDebug,
    threadPollMs: CHAT_THREAD_POLL_MS,
  });

  useChatNotesConversationBootstrap({
    conversationsLoading,
    setConversations,
    upsertSearchConversation,
  });

  useChatActiveConversationSurfaceEffects({
    activeConversationId,
    activeConversationKind: activeConversation?.kind,
    canUseAiChat,
    isMobile,
    messages,
    persistPinnedMessage,
    pinnedMessage,
    pinnedMessageStorageKey,
    setAiStatusByConversation,
    setPinnedMessage,
    showContextPanel,
    showTaskPanel,
  });

  useChatActiveConversationThreadBootstrap({
    activeConversationId,
    applyLatestThreadPayload,
    cancelPendingInitialAnchorRef,
    clearInitialViewportGuard,
    clearMobileKeyboardSettleTimeouts,
    focusComposerRef,
    hydratedThreadConversationIdRef,
    isMobile,
    lastHandledThreadLayoutKeyRef,
    loadThreadBootstrap,
    logChatDebugRef,
    messagesLoadingRequestSeqRef: core.messagesLoadingRequestSeqRef,
    mobileMotionDisabled,
    olderHistoryExhaustedRef,
    queueInitialThreadPositionRef,
    requestedConversationId,
    resetMessageSearch,
    resolvePendingInitialAnchorFromPayload,
    setEditingMessage,
    setMessages,
    setMessagesHasMore,
    setMessagesHasNewer,
    setMessagesLoading,
    setOlderHistoryUnavailable,
    setReplyMessage,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    userCacheId,
  });

  useChatActiveConversationLifecycleEffects({
    activeConversationId,
    activeConversationIdRef,
    closeAttachmentPreview,
    closeDocumentPreview,
    locationSearch: location.search,
    messagesLength: messages.length,
    messagesLoading,
    navigate,
    requestedConversationId,
    requestedMessageId,
    requestedMessageRevealKeyRef,
    revealMessageRef,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setSelectedMessageIds,
    setThreadMenuAnchor,
  });

  useChatConversationDraftRestore({
    activeConversationId,
    draftStorageKey,
    latestMessageTextRef,
    setEditingMessage,
    setMessageText,
    setReplyMessage,
    shareComposeDraftRef,
    suppressDraftSyncRef,
  });

  useEffect(() => {
    latestMessageTextRef.current = messageText;
  }, [latestMessageTextRef, messageText]);

  useChatUrlConversationBootstrap({
    activeConversationId,
    applyingRequestedConversationRef,
    cancelPendingInitialAnchor,
    clearStoredConversationState,
    composePrefillRequested,
    conversationBootstrapComplete,
    conversations,
    conversationsLoading,
    invalidConversationRef,
    isMobile,
    loadConversations,
    locationSearch: location.search,
    mobileHistoryReadyRef,
    navigate,
    notifyInfo,
    requestedConversationHandledRef,
    requestedConversationRetryRef,
    requestedConversationId,
    restoredConversationId,
    restoredMobileView,
    setActiveConversationId,
    setConversationBootstrapComplete,
    setMobileView,
    writeMobileHistoryState,
  });

  useChatContextPanelDetailPrefetch({
    activeConversationId,
    contextPanelOpen,
    infoOpen,
    loadConversationDetail,
  });

  const {
    handleOpenAiBot,
    handleOpenArchiveFolder,
    handleOpenPeer,
    openConversation,
  } = useChatNavigationController({
    activeConversationIdRef,
    conversationsRef,
    focusComposer,
    handleActiveFolderChange: core.handleActiveFolderChange,
    isMobile,
    logChatDebug,
    notifyApiError,
    openMobileThreadView,
    prefetchAdjacentThreadBootstraps,
    prefetchThreadBootstrap,
    resetMessageSearch,
    resetSidebarSearch,
    searchChats,
    setActiveConversationId,
    setAiBots,
    setAiStatusByConversation,
    setInfoOpen,
    setOpeningAiBotId,
    setOpeningPeerId,
    upsertConversation,
  });

  useChatComposePrefillBootstrap({
    focusComposer,
    loadConversations,
    locationSearch: location.search,
    navigate,
    notifyApiError,
    openConversation,
    resetSidebarSearch,
    shareComposeDraftRef,
  });

  const { shareTask: shareTaskFromHook } = useChatTaskSharing({
    activeConversationId,
    applyOutgoingThreadMessage,
    cancelPendingInitialAnchor,
    logChatDebug,
    notifyApiError,
    replyMessage,
    resetShareDialog,
    setReplyMessage,
    setSharingTaskId,
  });

  const composer = useChatPageComposerStack({
    activeConversation,
    activeConversationId,
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    composerRef,
    createOptimisticFileMessage,
    createOptimisticTextMessage,
    draftWriteTimeoutRef,
    editingMessage,
    fileInputRef,
    flushDraftToStorage: core.flushDraftToStorage,
    focusComposer,
    isMobile,
    latestMessageTextRef,
    logChatDebug,
    mediaFileInputRef,
    mergeMessageIntoThread,
    messageText,
    notifyApiError,
    notifyWarning,
    patchThreadMessage,
    removeThreadMessage,
    replyMessage,
    revokeObjectUrls,
    setComposerMenuAnchor,
    setEditingMessage,
    setEmojiAnchorEl,
    setMessageText,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    setSocketStatus,
    setThreadMenuAnchor,
    socketStatusRef,
    syncComposerSelection,
    userId: user?.id,
    emojiAnchorEl,
  });

  const {
    handleComposerSend,
    cancelVoiceRecording,
    clearSelectedFiles,
    closeFileDialog,
    fileCaption,
    fileDialogOpen,
    fileDragActive,
    fileUploadProgress,
    handleComposerDragLeave,
    handleComposerDragOver,
    handleComposerDrop,
    handleComposerPaste,
    handleSelectFiles,
    openFilePicker,
    openMediaPicker,
    preparingFiles,
    removeSelectedFile,
    selectedFiles,
    selectedFilesSummary,
    sendFiles,
    sendingFiles,
    setFileCaption,
    startVoiceRecording,
    stopVoiceRecording,
    voiceRecording,
    voiceRecordingDuration,
    voiceRecordingLevelRef,
    emojiPickerOpen,
    handleCloseEmojiPicker,
    handleComposerFocusChange,
    handleOpenComposerMenu,
    handleOpenEmojiPicker,
    handleOpenMenu,
    handleSendGif,
    clearEditingMessage,
    clearReplyMessage,
    handleComposerKeyDown,
  } = composer;

  const messageActions = useChatMessageActionsController({
    activeConversationId,
    activeConversationIdRef,
    buildPinnedMessagePayload,
    conversations,
    focusComposer,
    loadChatDialogsModule,
    loadConversations,
    mergeMessageIntoThread,
    messages,
    notifyApiError,
    notifyInfo,
    notifyWarning,
    openMediaViewer,
    openMessageReads,
    openTaskFromChat,
    openConversation,
    patchThreadMessage,
    persistPinnedMessage,
    pinnedMessage,
    promoteConversationToTop,
    queueAutoScroll,
    selectedMessages,
    setComposerMenuAnchor,
    setEditingMessage,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setMessageText,
    setReplyMessage,
    setSelectedMessageIds,
    setThreadMenuAnchor,
    syncConversationPreview,
    upsertThreadMessages,
  });

  const {
    cancelAiAction,
    chatMailAttachmentOptions,
    clearSelectedMessages,
    closeForwardDialog,
    closeMessageMenu,
    confirmAiAction,
    editAiAction,
    forwardConversationQuery,
    forwardHookMessageFromMenu,
    forwardHookMessageToConversation,
    forwardMessages,
    forwardOpen,
    forwardTargets,
    forwardingConversationId,
    handleCopyMessage,
    handleCopyMessageLink,
    handleDeleteMessageFromMenu,
    handleEditFromMessageMenu,
    handleOpenAttachmentFromMessageMenu,
    handleOpenReadsFromMessageMenu,
    handleOpenTaskFromMessageMenu,
    handleReplyFromMessageMenu,
    handleReplyMessage,
    handleReportMessageFromMenu,
    handleSelectMessageFromMenu,
    handleTogglePinMessageFromMenu,
    mailActionEditor,
    openMessageMenu,
    selectedCopySelectedMessages,
    selectedOpenForwardSelectedMessages,
    selectedReplyToSelectedMessage,
    setForwardConversationQuery,
    setMailActionEditor,
    startMessageSelection,
    submitMailActionEdit,
    toggleMessageSelection,
  } = messageActions;

  const messageChromeProps = useChatMessageChromeController({
    mailActionEditor,
    setMailActionEditor,
    chatMailAttachmentOptions,
    submitMailActionEdit,
  });

  const { shouldRenderChatDialogs } = useChatDialogsController({
    threadMenuAnchor,
    messageMenuAnchor,
    composerMenuAnchor,
    emojiAnchorEl,
    groupOpen,
    shareOpen,
    forwardOpen,
    fileDialogOpen,
    attachmentPreview,
    documentPreview,
    messageReadsOpen,
    searchOpen,
    isMobile,
    infoOpen,
  });

  useChatPageRealtimeEffects({
    activeConversationId,
    activeConversation,
    activeConversationIdRef,
    activeThreadTransportState,
    activeAiStatus,
    canUseAiChat,
    conversationBootstrapComplete,
    degradedThreadRevalidateCountRef,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebug,
    logChatDebugRef,
    messagesLoadingRef,
    messagesRef,
    sidebarSearchActive,
    socketStatus,
    aiRunStartedAtByConversationRef,
    applyMessageReadDelta,
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation,
    latestActiveThreadSocketMessageRef,
    markConversationReadLiveRef,
    markSocketActivity,
    mergeMessageIntoThread,
    onConversationRemoved: handleRemoteConversationRemoved,
    promoteConversationToTop,
    queueAutoScroll,
    setAiStatusByConversation,
    setMessages,
    setSocketStatus,
    setTypingUsers,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    socketStatusRef,
    syncConversationPreview,
    threadNearBottomRef,
    typingParticipantsTimeoutsRef,
    updatePresenceInCollections,
    upsertConversation,
    userId: user?.id,
  });

  useChatAutoScrollLayoutEffect({
    activeConversationId,
    activeConversationIdRef,
    applyPendingInitialAnchor,
    autoScrollMetaRef,
    autoScrollRef,
    cancelPendingInitialAnchor,
    isPhone,
    logChatDebug,
    messages,
    pendingInitialAnchorRef,
    scheduleMobileKeyboardBottomSettle,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    scrollThreadBottomIntoView,
    scrollThreadToBottomInstant,
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
    threadScrollRef,
  });

  useChatMobileViewGuardEffects({
    activeConversation,
    activeConversationId,
    conversationBootstrapComplete,
    infoOpen,
    isMobile,
    messagesLoading,
    mobileView,
    resolvedMobileView,
    setInfoOpen,
    setMobileView,
  });

  const showOlderHistoryControl = useMemo(
    () => shouldShowOlderHistoryControl({
      messagesHasMore,
      messageCount: messages.length,
      olderHistoryUnavailable,
    }),
    [messages.length, messagesHasMore, olderHistoryUnavailable],
  );

  const mobileScreenVariants = useMemo(
    () => buildChatMobileScreenVariants({ motionDisabled: mobileMotionDisabled }),
    [mobileMotionDisabled],
  );

  const skipRowEnterAnimation = isMobile && mobileTransitionDirection === -1;

  const pageLayoutCtx = useChatPageLayoutContext(
    useMemo(
      () => pickChatPageLayoutSections({
        theme, ui, isMobile, isPhone, mobileMotionDisabled,
        health, user, unreadTotal, sidebarQuery, setSidebarQuery, sidebarSearchActive, searchingSidebar,
        searchPeople, searchChats, searchResultEmpty, openingPeerId, handleOpenPeer, activeConversationId,
        openConversation, prefetchThreadBootstrap, conversationsLoading, filteredConversations, openGroupDialog,
        sidebarScrollRef, handleSidebarScroll, conversationFilter, handleActiveFolderChange: core.handleActiveFolderChange, customFolders, conversationFilterCounts,
        conversationIdsByFolder, handleOpenFolderManager, handleOpenArchiveFolder, handleToggleConversationInFolder,
        draftsByConversation, updateConversationSettings, requestDeleteConversation, requestLeaveConversation,
        conversationActionPendingId, aiSidebarRows, aiBotsLoading, aiBotsError, canUseAiChat, handleOpenAiBot,
        openingAiBotId, skipRowEnterAnimation, activeConversation, navigate, threadWallpaperSx, messages, messagesLoading,
        effectiveLastReadMessageId, showOlderHistoryControl, loadingOlder, prependScrollRestoreRef, loadOlderMessages,
        threadScrollRef, threadContentRef, handleThreadScroll, bottomRef, openMobileInboxView, handleOpenInfo,
        openTaskFromChat, openSearchDialog, handleOpenMenu, openMessageReads, openMediaViewer, handleReplyMessage,
        openMessageMenu, confirmAiAction, cancelAiAction, editAiAction, selectedVisibleMessageIds, selectedMessageCount,
        canCopySelectedMessages, toggleMessageSelection, startMessageSelection, clearSelectedMessages,
        selectedReplyToSelectedMessage, selectedCopySelectedMessages, selectedOpenForwardSelectedMessages,
        handleOpenComposerMenu, composerRef, messageText, setMessageText, handleComposerKeyDown, syncComposerSelection,
        handleOpenEmojiPicker, handleCloseEmojiPicker, handleComposerFocusChange, handleComposerSend, handleComposerPaste,
        handleComposerDrop, handleComposerDragOver, handleComposerDragLeave, mentionCandidates, searchMentionPeople,
        fileDragActive, showJumpToLatest, jumpToLatest, replyMessage, clearReplyMessage, editingMessage,
        clearEditingMessage, aiTypingStatus, activeAiStatus, pinnedMessage, handleOpenPinnedMessage,
        handleUnpinPinnedMessage, highlightedMessageId, conversationMetaSubtitle, aiAwareTypingLine,
        renderDesktopRightPanel, selectedFiles, fileCaption, openFilePicker, clearSelectedFiles, preparingFiles,
        sendingFiles, fileUploadProgress, selectedFilesSummary, getReadTargetRef, handleToggleReaction, scrollToMessage,
        emojiPickerOpen, insertEmojiAtSelection, handleSendGif, voiceRecording, voiceRecordingDuration,
        voiceRecordingLevelRef, startVoiceRecording, stopVoiceRecording, cancelVoiceRecording, bindPinnedScroll,
        showTaskPanel, showContextPanel, taskPanelTaskId, closeTaskPanel, openTaskInTasks, handleTaskPanelUpdated,
        setContextPanelOpen, openShareDialog, handleAddGroupMembers, handleRemoveGroupMember, handleUpdateGroupMemberRole,
        handleTransferGroupOwnership, handleLeaveGroup, handleUpdateGroupProfile, settingsUpdating, socketStatus,
        currentUser: user, threadMenuAnchor, setThreadMenuAnchor, infoOpen,
        messageMenuAnchor, messageMenuMessage, closeMessageMenu, handleReplyFromMessageMenu, handleCopyMessage,
        handleTogglePinMessageFromMenu, handleCopyMessageLink, forwardHookMessageFromMenu, handleReportMessageFromMenu,
        handleDeleteMessageFromMenu, handleEditFromMessageMenu, handleSelectMessageFromMenu,
        handleOpenReadsFromMessageMenu, handleOpenAttachmentFromMessageMenu, handleOpenTaskFromMessageMenu,
        composerMenuAnchor, setComposerMenuAnchor, openMediaPicker, emojiAnchorEl, mediaFileInputRef,
        handleSelectFiles, fileDialogOpen, closeFileDialog, setFileCaption, sendFiles, removeSelectedFile,
        groupOpen, closeGroupDialog, groupTitle, setGroupTitle, groupSearch, setGroupSearch, groupUsers, groupUsersLoading,
        groupSelectedUsers, groupMemberIds, addGroupMember, removeGroupMember, creatingConversation, groupCreateDisabled,
        createGroup, shareOpen, resetShareDialog, taskSearch, setTaskSearch, shareableTasks, shareableLoading,
        sharingTaskId, shareTaskFromHook, forwardOpen, closeForwardDialog, forwardMessages, forwardConversationQuery,
        setForwardConversationQuery, forwardTargets, forwardingConversationId, forwardHookMessageToConversation,
        attachmentPreview, closeAttachmentPreview, documentPreview, closeDocumentPreview,
        handleDownloadDocumentPreview, handleDownloadDocumentPreviewPdf, messageReadsOpen, setMessageReadsOpen,
        messageReadsMessage, messageReadsLoading, messageReadsItems, closeMobileInfoView,
        requestConversationRemoval, searchOpen, closeSearchDialog, messageSearch, setMessageSearch,
        messageSearchResults, messageSearchLoading, messageSearchHasMore, loadMoreSearchResults, openSearchResult,
      }),
      [
        theme, ui, isMobile, isPhone, mobileMotionDisabled,
        health, user, unreadTotal, sidebarQuery, setSidebarQuery, sidebarSearchActive, searchingSidebar,
        searchPeople, searchChats, searchResultEmpty, openingPeerId, handleOpenPeer, activeConversationId,
        openConversation, prefetchThreadBootstrap, conversationsLoading, filteredConversations, openGroupDialog,
        sidebarScrollRef, handleSidebarScroll, conversationFilter, core.handleActiveFolderChange, customFolders, conversationFilterCounts,
        conversationIdsByFolder, handleOpenFolderManager, handleOpenArchiveFolder, handleToggleConversationInFolder,
        draftsByConversation, updateConversationSettings, requestDeleteConversation, requestLeaveConversation,
        conversationActionPendingId, aiSidebarRows, aiBotsLoading, aiBotsError, canUseAiChat, handleOpenAiBot,
        openingAiBotId, skipRowEnterAnimation, activeConversation, navigate, threadWallpaperSx, messages, messagesLoading,
        effectiveLastReadMessageId, showOlderHistoryControl, loadingOlder, prependScrollRestoreRef, loadOlderMessages,
        threadScrollRef, threadContentRef, handleThreadScroll, bottomRef, openMobileInboxView, handleOpenInfo,
        openTaskFromChat, openSearchDialog, handleOpenMenu, openMessageReads, openMediaViewer, handleReplyMessage,
        openMessageMenu, confirmAiAction, cancelAiAction, editAiAction, selectedVisibleMessageIds, selectedMessageCount,
        canCopySelectedMessages, toggleMessageSelection, startMessageSelection, clearSelectedMessages,
        selectedReplyToSelectedMessage, selectedCopySelectedMessages, selectedOpenForwardSelectedMessages,
        handleOpenComposerMenu, composerRef, messageText, setMessageText, handleComposerKeyDown, syncComposerSelection,
        handleOpenEmojiPicker, handleCloseEmojiPicker, handleComposerFocusChange, handleComposerSend, handleComposerPaste,
        handleComposerDrop, handleComposerDragOver, handleComposerDragLeave, mentionCandidates, searchMentionPeople,
        fileDragActive, showJumpToLatest, jumpToLatest, replyMessage, clearReplyMessage, editingMessage,
        clearEditingMessage, aiTypingStatus, activeAiStatus, pinnedMessage, handleOpenPinnedMessage,
        handleUnpinPinnedMessage, highlightedMessageId, conversationMetaSubtitle, aiAwareTypingLine,
        renderDesktopRightPanel, selectedFiles, fileCaption, openFilePicker, clearSelectedFiles, preparingFiles,
        sendingFiles, fileUploadProgress, selectedFilesSummary, getReadTargetRef, handleToggleReaction, scrollToMessage,
        emojiPickerOpen, insertEmojiAtSelection, handleSendGif, voiceRecording, voiceRecordingDuration,
        voiceRecordingLevelRef, startVoiceRecording, stopVoiceRecording, cancelVoiceRecording, bindPinnedScroll,
        showTaskPanel, showContextPanel, taskPanelTaskId, closeTaskPanel, openTaskInTasks, handleTaskPanelUpdated,
        setContextPanelOpen, openShareDialog, handleAddGroupMembers, handleRemoveGroupMember, handleUpdateGroupMemberRole,
        handleTransferGroupOwnership, handleLeaveGroup, handleUpdateGroupProfile, settingsUpdating, socketStatus,
        threadMenuAnchor, setThreadMenuAnchor, infoOpen,
        messageMenuAnchor, messageMenuMessage, closeMessageMenu, handleReplyFromMessageMenu, handleCopyMessage,
        handleTogglePinMessageFromMenu, handleCopyMessageLink, forwardHookMessageFromMenu, handleReportMessageFromMenu,
        handleDeleteMessageFromMenu, handleEditFromMessageMenu, handleSelectMessageFromMenu,
        handleOpenReadsFromMessageMenu, handleOpenAttachmentFromMessageMenu, handleOpenTaskFromMessageMenu,
        composerMenuAnchor, setComposerMenuAnchor, openMediaPicker, emojiAnchorEl, mediaFileInputRef,
        handleSelectFiles, fileDialogOpen, closeFileDialog, setFileCaption, sendFiles, removeSelectedFile,
        groupOpen, closeGroupDialog, groupTitle, setGroupTitle, groupSearch, setGroupSearch, groupUsers, groupUsersLoading,
        groupSelectedUsers, groupMemberIds, addGroupMember, removeGroupMember, creatingConversation, groupCreateDisabled,
        createGroup, shareOpen, resetShareDialog, taskSearch, setTaskSearch, shareableTasks, shareableLoading,
        sharingTaskId, shareTaskFromHook, forwardOpen, closeForwardDialog, forwardMessages, forwardConversationQuery,
        setForwardConversationQuery, forwardTargets, forwardingConversationId, forwardHookMessageToConversation,
        attachmentPreview, closeAttachmentPreview, documentPreview, closeDocumentPreview,
        handleDownloadDocumentPreview, handleDownloadDocumentPreviewPdf, messageReadsOpen, setMessageReadsOpen,
        messageReadsMessage, messageReadsLoading, messageReadsItems, closeMobileInfoView,
        requestConversationRemoval, searchOpen, closeSearchDialog, messageSearch, setMessageSearch,
        messageSearchResults, messageSearchLoading, messageSearchHasMore, loadMoreSearchResults, openSearchResult,
      ],
    ),
  );

  const {
    sidebarPane,
    threadPane,
    desktopRightPanelContent,
    chatPageDialogsLayerProps,
  } = useChatPageLayoutInputs(pageLayoutCtx);

  return (
    <ChatShellLayout
      headerMode={isPhone ? 'hidden' : 'default'}
      mobileBottomNavMode={resolveChatMobileBottomNavMode(isMobile, pageState.mobileBottomNavHidden)}
      mobileBottomNavTransitionMs={CHAT_MOBILE_SCREEN_TRANSITION_MS}
      pageShellSx={{
        bgcolor: isPhone ? ui.threadBg : ui.pageBg,
        gap: isPhone ? 0 : 1.5,
        height: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        overscrollBehaviorY: 'none',
      }}
    >
      <Stack spacing={isPhone ? 0 : 1.5} sx={{ flex: 1, minHeight: 0 }}>
        <ChatPageMessageChrome
          isPhone={isPhone}
          fileInputRef={fileInputRef}
          mediaFileInputRef={mediaFileInputRef}
          onSelectFiles={handleSelectFiles}
          healthError={healthError}
          activeAiLiveDataNotice={activeAiLiveDataNotice}
          {...messageChromeProps}
        />

        <ChatPageDesktopLayout
          isMobile={isMobile}
          isPhone={isPhone}
          ui={ui}
          theme={theme}
          sidebarPane={sidebarPane}
          threadPane={threadPane}
          desktopRightPanelContent={desktopRightPanelContent}
          renderDesktopRightPanel={renderDesktopRightPanel}
          renderPersistentRightPanel={renderPersistentRightPanel}
          showTaskPanel={showTaskPanel}
          closeTaskPanel={closeTaskPanel}
          onCloseContextPanel={() => setContextPanelOpen(false)}
          contextPanelEnterDuration={contextPanelEnterDuration}
          contextPanelExitDuration={contextPanelExitDuration}
          resolvedMobileView={resolvedMobileView}
          mobileTransitionDirection={mobileTransitionDirection}
          mobileMotionDisabled={mobileMotionDisabled}
          mobileScreenVariants={mobileScreenVariants}
          mobileScreenTransition={mobileScreenTransition}
          handleMobileThreadScreenAnimationComplete={handleMobileThreadScreenAnimationComplete}
        />

        <ChatPageDialogsLayer
          open={shouldRenderChatDialogs}
          {...chatPageDialogsLayerProps}
        />

        <ChatPageConversationActionDialog
          open={Boolean(conversationActionTarget)}
          isLeave={conversationActionIsLeave}
          title={conversationActionTitle}
          conversation={conversationActionConversation}
          conversationId={conversationActionId}
          pending={Boolean(conversationActionPendingId)}
          onClose={() => closeConversationAction()}
          onConfirm={confirmConversationAction}
        />

        <ChatPageFolderDialogsSection
          open={folderManagerOpen}
          createMode={folderManagerCreateMode}
          folders={customFolders}
          conversations={conversations}
          conversationIdsByFolder={conversationIdsByFolder}
          saving={folderSaving || foldersLoading}
          onClose={() => {
            setFolderManagerOpen(false);
            setFolderManagerCreateMode(false);
          }}
          onCreateFolder={handleCreateChatFolder}
          onRenameFolder={handleRenameChatFolder}
          onDeleteFolder={handleDeleteChatFolder}
          onReorderFolder={handleReorderChatFolder}
          onRemoveConversationFromFolder={handleRemoveConversationFromFolder}
        />
      </Stack>
    </ChatShellLayout>
  );
}

export * from './chatModel';
export {
  CHAT_AI_ACTIVE_POLL_MS,
  CHAT_AI_ACTIVE_POLL_WS_CONNECTED_MS,
  CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS,
  CHAT_LIST_POLL_MS,
  CHAT_MESSAGE_HIGHLIGHT_MS,
  CHAT_SEARCH_DEBOUNCE_MS,
  CHAT_SWR_STALE_TIME_MS,
  CHAT_THREAD_POLL_MS,
} from './chatPageConstants';
export {
  readSelectedDatabaseId,
  readSessionStorageValue,
  resolveRestoredMobileView,
} from './chatSessionStorage';
export { emitChatUnreadRefresh } from './chatUnreadRefresh';
export {
  scheduleMessageHighlight,
  scrollThreadToMessage,
} from './useChatMessageScrollHighlight';
export { default as useChatMessageScrollHighlight } from './useChatMessageScrollHighlight';
export { default as useChatPageRefs } from './useChatPageRefs';
export { default as useChatPageLayoutInputs } from './useChatPageLayoutInputs';
export { default as useChatPageLayoutContext } from './useChatPageLayoutContext';
export { default as useChatSidebarSection } from './useChatSidebarSection';
export { default as useChatThreadSection } from './useChatThreadSection';
export { default as useChatPageInitialState } from './useChatPageInitialState';
export { default as useChatMessageChromeController } from './useChatMessageChromeController';
export { default as useChatPageRealtimeEffects } from './useChatPageRealtimeEffects';
export { default as useChatPageAnchorScrollBridge } from './useChatPageAnchorScrollBridge';
export { default as useChatPageOverlayDialogs } from './useChatPageOverlayDialogs';
export { default as useChatMobileThreadAnimation } from './useChatMobileThreadAnimation';
export { default as useChatPagePanelsBridge, useChatPageBrowserConversationId } from './useChatPagePanelsBridge';
export { default as useChatPageComposerStack } from './useChatPageComposerStack';
export { syncChatPageCollectionRefs } from './syncChatPageCollectionRefs';
export {
  buildChatMobileScreenTransition,
  resolveChatMobileView,
} from './chatMobilePresentation';

export * from './controllers/index';

import useChatAiController from './useChatAiController';
import useChatConversationsController from './useChatConversationsController';
import useChatDraftsAndPinned from './useChatDraftsAndPinned';
import useChatFoldersController from './useChatFoldersController';
import useChatMobileNavigation from './useChatMobileNavigation';
import useChatThreadController from './useChatThreadController';
import useChatSocketController from './useChatSocketController';

export {
  loadChatDialogsModule,
  computeShouldRenderChatDialogs,
} from './useChatDialogsController';
export {
  useChatSocketControllerEvents,
  SOCKET_ACTIVITY_COALESCE_MS,
} from './useChatSocketController';
export {
  computePanelVisibility,
  computeContextPanelDurations,
  loadChatContextPanelModule,
  loadTaskWorkspacePanelModule,
  CONTEXT_PANEL_ENTER_MS,
  CONTEXT_PANEL_EXIT_MS,
} from './useChatPanelsController';
export { revokeDocumentPreviewObjectUrl } from './useChatPreviewController';
export { default as useChatPageDialogsLayerProps } from './useChatPageDialogsLayerProps';
export { default as buildChatPageDialogsLayerProps } from './buildChatPageDialogsLayerProps';
export { default as buildChatPagePanesBags } from './buildChatPagePanesBags';
export { default as ChatPageDesktopLayout } from './ChatPageDesktopLayout';
export { default as ChatPageMessageChrome } from './ChatPageMessageChrome';
export {
  resolveActiveConversationSummary,
  mergeActiveConversation,
  buildMentionCandidates,
} from './chatActiveConversationModel';
export { resolveComposerSelectionRange } from './useChatComposerSelection';
export { default as useChatNotesConversationBootstrap } from './useChatNotesConversationBootstrap';
export { default as useChatUrlConversationBootstrap } from './useChatUrlConversationBootstrap';
export { default as useChatActiveConversationThreadBootstrap } from './useChatActiveConversationThreadBootstrap';
export { default as useChatActiveConversationSurfaceEffects } from './useChatActiveConversationSurfaceEffects';
export { default as useChatConversationDraftRestore } from './useChatConversationDraftRestore';
export { default as useChatActiveConversationLifecycleEffects } from './useChatActiveConversationLifecycleEffects';
export { default as useChatSessionPersistenceEffects } from './useChatSessionPersistenceEffects';
export { default as useChatMobileViewGuardEffects } from './useChatMobileViewGuardEffects';
export { default as useChatComposePrefillBootstrap } from './useChatComposePrefillBootstrap';
export { default as useChatContextPanelDetailPrefetch } from './useChatContextPanelDetailPrefetch';
export { default as useChatPageBootEffects, CHAT_PAGE_THREAD_POLL_MS } from './useChatPageBootEffects';
export { default as useChatOptimisticThreadMessages } from './useChatOptimisticThreadMessages';
export { default as useChatThreadMessageMerge } from './useChatThreadMessageMerge';
export {
  buildReplyPreview,
  buildOptimisticFileMessage,
  buildOptimisticTextMessage,
  isLikelyOptimisticReplacement,
  revokeOptimisticObjectUrls,
  withStableThreadMessageRenderKey,
} from './chatOptimisticMessages';
export {
  removeThreadMessageFromList,
  resolveThreadMessageMerge,
  upsertThreadMessagesInList,
} from './chatThreadMessageMerge';
export { buildChatThreadWallpaperSx } from './chatThreadWallpaper';
export { default as useChatThreadHeaderPresentation } from './useChatThreadHeaderPresentation';
export { default as useChatMobileBottomNavEffects } from './useChatMobileBottomNavEffects';
export { default as useChatMountCleanupEffects } from './useChatMountCleanupEffects';
export { default as useChatConversationSyncCallbacks, patchConversationWithPresence } from './useChatConversationSyncCallbacks';
export { default as useChatAutoScrollLayoutEffect } from './useChatAutoScrollLayoutEffect';
export { default as useChatDebugController, CHAT_DEBUG_STORAGE_KEY } from './useChatDebugController';
export { default as useChatRevealMessage } from './useChatRevealMessage';
export { default as useChatHealthBootstrap } from './useChatHealthBootstrap';
export { default as useChatThreadPrefetch } from './useChatThreadPrefetch';
export { default as useChatComposerSelection } from './useChatComposerSelection';
export { default as useChatMarkReadLive } from './useChatMarkReadLive';
export { default as useChatActiveConversation } from './useChatActiveConversation';
export { default as useChatAiPresentation } from './useChatAiPresentation';
export { default as useChatConversationDetailService } from './useChatConversationDetailService';
export { default as useChatSidebarDerivedState } from './useChatSidebarDerivedState';
export { default as useChatMessageSelection } from './useChatMessageSelection';
export { default as useChatBottomInstantFrameCleanup } from './useChatBottomInstantFrameCleanup';

/**
 * Page-level orchestrator. Domain hooks delegate thread, sidebar, mobile, folders, AI, and drafts.
 */
export default function useChatPageController({
  thread: threadControllerArgs,
  conversations: conversationsControllerArgs,
  mobile: mobileControllerArgs,
  folders: foldersControllerArgs,
  ai: aiControllerArgs,
  drafts: draftsControllerArgs,
  socket: socketControllerArgs,
} = {}) {
  const thread = useChatThreadController(threadControllerArgs || {});
  const sidebar = conversationsControllerArgs
    ? useChatConversationsController(conversationsControllerArgs)
    : {};
  const mobile = mobileControllerArgs
    ? useChatMobileNavigation(mobileControllerArgs)
    : {};
  const folders = foldersControllerArgs
    ? useChatFoldersController(foldersControllerArgs)
    : {};
  const ai = aiControllerArgs
    ? useChatAiController(aiControllerArgs)
    : {};
  const drafts = draftsControllerArgs
    ? useChatDraftsAndPinned(draftsControllerArgs)
    : {};
  const socket = socketControllerArgs
    ? useChatSocketController(socketControllerArgs)
    : {};

  return {
    thread,
    sidebar,
    mobile,
    folders,
    ai,
    drafts,
    socket,
  };
}

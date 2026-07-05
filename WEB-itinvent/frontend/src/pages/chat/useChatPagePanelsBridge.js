import { useCallback } from 'react';

import useChatPreviewController from './useChatPreviewController';
import useChatPanelsController from './useChatPanelsController';
import { loadChatDialogsModule } from './useChatDialogsController';

export default function useChatPagePanelsBridge({
  activeConversation,
  activeConversationIdRef,
  activeTaskConversationTaskId,
  getCurrentBrowserConversationId,
  mobileNavRef,
  isMobile,
  isWideDesktop,
  prefersReducedMotion,
  loadConversationDetail,
  loadConversationsRef,
  mobileHistoryReadyRef,
  setConversations,
  setConversationDetailsById,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setThreadMenuAnchor,
  userId,
  messagesRef,
  notifyApiError,
}) {
  const preview = useChatPreviewController({
    activeConversationIdRef,
    loadChatDialogsModule,
    messagesRef,
    notifyApiError,
  });

  const panels = useChatPanelsController({
    activeConversation,
    activeConversationIdRef,
    activeTaskConversationTaskId,
    getCurrentBrowserConversationId,
    getMobileNav: () => mobileNavRef.current,
    isMobile,
    isWideDesktop,
    loadChatDialogsModule,
    loadConversationDetail,
    loadConversationsRef,
    mobileHistoryReadyRef,
    prefersReducedMotion,
    setConversations,
    setConversationDetailsById,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
    userId,
  });

  return {
    ...preview,
    ...panels,
  };
}

export function useChatPageBrowserConversationId() {
  return useCallback(() => {
    if (typeof window === 'undefined') return '';
    return String(new URLSearchParams(window.location.search).get('conversation') || '').trim();
  }, []);
}

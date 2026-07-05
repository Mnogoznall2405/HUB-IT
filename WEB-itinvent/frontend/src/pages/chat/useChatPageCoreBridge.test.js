import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./useChatPageController', () => ({
  default: vi.fn(() => ({
    thread: {
      messages: [],
      setMessages: vi.fn(),
      messagesLoading: false,
      messagesLoadingRequestSeqRef: { current: 0 },
    },
    sidebar: {
      loadConversations: vi.fn(),
      applyConversationsPayload: vi.fn(),
    },
    folders: {
      loadChatFolders: vi.fn(),
      handleActiveFolderChange: vi.fn(),
      applyFoldersPayload: vi.fn(),
      restoreFolderFilter: vi.fn(),
    },
    ai: {
      loadAiBots: vi.fn(),
      applyAiBotsPayload: vi.fn(),
      fetchConversationAiStatus: vi.fn(),
    },
    drafts: {
      draftStorageKey: 'draft-key',
      pinnedStorageKey: 'pinned-key',
      flushDraftToStorage: vi.fn(),
      persistPinnedMessage: vi.fn(),
    },
  })),
}));

vi.mock('./useChatFolderMutationsController', () => ({
  default: vi.fn(() => ({
    handleCreateChatFolder: vi.fn(),
    handleDeleteChatFolder: vi.fn(),
    handleOpenFolderManager: vi.fn(),
    handleRemoveConversationFromFolder: vi.fn(),
    handleRenameChatFolder: vi.fn(),
    handleReorderChatFolder: vi.fn(),
    handleToggleConversationInFolder: vi.fn(),
  })),
}));

import useChatPageCoreBridge from './useChatPageCoreBridge';

describe('useChatPageCoreBridge', () => {
  it('wires domain controllers and exposes thread and folder APIs', () => {
    const refs = {
      activeConversationIdRef: { current: '' },
      autoScrollMetaRef: { current: null },
      autoScrollRef: { current: false },
      cancelPendingInitialAnchorRef: { current: null },
      capturePrependScrollRestoreRef: { current: null },
      conversationsRef: { current: [] },
      hasPendingInitialAnchorForConversationRef: { current: false },
      hydratedThreadConversationIdRef: { current: '' },
      isInitialViewportGuardActiveRef: { current: false },
      loadOlderInFlightCursorRef: { current: '' },
      logChatDebugRef: { current: vi.fn() },
      prependScrollRestoreRef: { current: null },
      resolvePendingInitialAnchorFromPayloadRef: { current: vi.fn() },
      scrollThreadBottomIntoViewRef: { current: vi.fn() },
      scrollToMessageRef: { current: vi.fn() },
      showJumpToLatestRef: { current: false },
      syncConversationPreviewRef: { current: vi.fn() },
      threadLoadAbortRef: { current: null },
      threadNearBottomRef: { current: true },
      threadPrefetchAbortControllersRef: { current: new Map() },
      conversationsCacheHydratedRef: { current: false },
      conversationsLoadingRef: { current: false },
      conversationsLoadingRequestSeqRef: { current: 0 },
      conversationsRequestSeqRef: { current: 0 },
      lastConversationsLoadAtRef: { current: 0 },
      sidebarScrollRef: { current: null },
      aiBotsRequestSeqRef: { current: 0 },
      aiBotsLoadingRequestSeqRef: { current: 0 },
      aiBotsLoadingRef: { current: false },
      aiBotsCacheHydratedRef: { current: false },
      suppressDraftSyncRef: { current: false },
      draftWriteTimeoutRef: { current: null },
      latestDraftStorageKeyRef: { current: '' },
      latestMessageTextRef: { current: '' },
      loadConversationsRef: { current: vi.fn() },
      loadMessagesRef: { current: vi.fn() },
      setShowJumpToLatest: vi.fn(),
    };

    const { result } = renderHook(() => useChatPageCoreBridge({
      activeConversationId: 'conv-1',
      refs,
      initialConversationId: '',
      initialThreadCache: null,
      conversationsCacheKeyParts: ['chat', 'conv'],
      userCacheId: 'user-1',
      notifyApiError: vi.fn(),
      setConversations: vi.fn(),
      setConversationsLoading: vi.fn(),
      setCustomFolders: vi.fn(),
      setConversationIdsByFolder: vi.fn(),
      setFoldersLoading: vi.fn(),
      setConversationFilter: vi.fn(),
      canUseAiChat: true,
      aiBotsCacheKeyParts: ['ai'],
      setAiBots: vi.fn(),
      setAiBotsLoading: vi.fn(),
      setAiBotsError: vi.fn(),
      setAiStatusByConversation: vi.fn(),
      user: { id: 1 },
      messageText: '',
      pinnedMessage: null,
      setPinnedMessage: vi.fn(),
      conversationFilter: 'all',
      customFolders: [],
      setFolderManagerCreateMode: vi.fn(),
      setFolderManagerOpen: vi.fn(),
      setFolderSaving: vi.fn(),
    }));

    expect(typeof result.current.loadConversations).toBe('function');
    expect(typeof result.current.loadChatFolders).toBe('function');
    expect(typeof result.current.loadAiBots).toBe('function');
    expect(result.current.draftStorageKey).toBe('draft-key');
    expect(typeof result.current.handleCreateChatFolder).toBe('function');
    expect(result.current.messagesLoadingRequestSeqRef).toEqual({ current: 0 });
  });
});

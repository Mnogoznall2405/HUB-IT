import React, { useRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { CHAT_SOCKET_STATUS_EVENT } from '../../lib/chatSocket';
import { clearSWRCache } from '../../lib/swrCache';
import useChatActiveThreadPolling from '../../components/chat/useChatActiveThreadPolling';
import useChatConversationsController from './useChatConversationsController';
import useChatSocketController, { useChatSocketControllerEvents } from './useChatSocketController';
import useChatThreadController from './useChatThreadController';
import { mergeAiStatusPayload } from './chatAiModel';
import {
  buildActiveThreadPollLoadOptions,
  shouldPollActiveThreadIncrementally,
  shouldSkipActiveThreadRevalidate,
} from './chatThreadTransport';
import { hasPersistedThreadMessageEquivalent } from './chatThreadMessages';

const socketState = vi.hoisted(() => ({ value: 'connecting' }));

vi.mock('../../api/client', () => ({
  chatAPI: {
    getConversations: vi.fn(),
    getMessages: vi.fn(),
    getThreadBootstrap: vi.fn(),
    hydrateThreadMessages: vi.fn(async () => ({ items: [] })),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
  CHAT_WS_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    chatSocket: {
      getConnectionState: () => socketState.value,
      isOpen: () => socketState.value === 'connected',
      watchPresence: vi.fn(() => Promise.resolve()),
      subscribeConversation: vi.fn(),
      unsubscribeConversation: vi.fn(),
      sendTyping: vi.fn(),
      sendMessage: vi.fn(),
      markRead: vi.fn(),
      reconnectNow: vi.fn(),
      close: vi.fn(),
    },
  };
});

vi.mock('../../lib/debugClientLog', () => ({
  emitAgentDebugLog: vi.fn(),
}));

// Mirrors the ChatPageContent wiring order: controllers that assign the shared
// refs mount first, then the realtime consumers (polling → socket events).
// loadMessagesRef / loadConversationsRef are plain page-style refs — nothing in
// the harness injects the callbacks; only the controllers' own effects do (R2).
function PageWiringHarness() {
  const activeConversationIdRef = useRef('conv-1');
  const aiRunStartedAtByConversationRef = useRef({});
  const autoScrollMetaRef = useRef(null);
  const autoScrollRef = useRef(false);
  const cancelPendingInitialAnchorRef = useRef(vi.fn());
  const capturePrependScrollRestoreRef = useRef(() => null);
  const conversationsCacheHydratedRef = useRef(false);
  const conversationsLoadingRef = useRef(false);
  const conversationsLoadingRequestSeqRef = useRef(0);
  const conversationsRef = useRef([]);
  const conversationsRequestSeqRef = useRef(0);
  const degradedThreadRevalidateCountRef = useRef(0);
  const failedThreadMessagesRef = useRef(new Map());
  const hasPendingInitialAnchorForConversationRef = useRef(() => false);
  const hydratedThreadConversationIdRef = useRef('');
  const isInitialViewportGuardActiveRef = useRef(() => false);
  const lastConversationsLoadAtRef = useRef(0);
  const lastForegroundRefreshAtRef = useRef(0);
  const latestActiveThreadSocketMessageRef = useRef(null);
  const loadConversationsRef = useRef(null);
  const loadMessagesRef = useRef(null);
  const loadOlderInFlightCursorRef = useRef('');
  const logChatDebugRef = useRef(vi.fn());
  const markConversationReadLiveRef = useRef(vi.fn());
  const prependScrollRestoreRef = useRef(null);
  const resolvePendingInitialAnchorFromPayloadRef = useRef(() => false);
  const scrollThreadBottomIntoViewRef = useRef(vi.fn());
  const scrollToMessageRef = useRef(() => false);
  const showJumpToLatestRef = useRef(false);
  const sidebarScrollRef = useRef(null);
  const skippedInitialSnapshotRefreshRef = useRef(false);
  const skippedInitialSocketRefreshRef = useRef(false);
  const syncConversationPreviewRef = useRef(vi.fn());
  const threadLoadAbortRef = useRef(null);
  const threadNearBottomRef = useRef(true);
  const threadPrefetchAbortControllersRef = useRef(new Map());

  const thread = useChatThreadController({
    activeConversationId: 'conv-1',
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    cancelPendingInitialAnchorRef,
    capturePrependScrollRestoreRef,
    conversationsRef,
    failedThreadMessagesRef,
    hasPendingInitialAnchorForConversationRef,
    hydratedThreadConversationIdRef,
    // No initialConversationId → messagesLoading starts false, mirroring the
    // mounted page after its initial bootstrap; the degraded poll must fire.
    initialConversationId: '',
    initialThreadCache: null,
    isInitialViewportGuardActiveRef,
    loadMessagesRef,
    loadOlderInFlightCursorRef,
    logChatDebugRef,
    notifyApiError: vi.fn(),
    prependScrollRestoreRef,
    resolvePendingInitialAnchorFromPayloadRef,
    scrollThreadBottomIntoViewRef,
    scrollToMessageRef,
    setShowJumpToLatest: vi.fn(),
    showJumpToLatestRef,
    syncConversationPreviewRef,
    threadLoadAbortRef,
    threadNearBottomRef,
    threadPrefetchAbortControllersRef,
    userCacheId: 'user-1',
  });

  const socket = useChatSocketController({
    activeConversationId: 'conv-1',
    deferredMessageText: '',
    logChatDebugRef,
    skippedInitialSocketRefreshRef,
    watchedPresenceUserIds: [],
    watchedPresenceUserIdsKey: '',
  });

  const conversations = useChatConversationsController({
    userCacheId: 'user-1',
    notifyApiError: vi.fn(),
    setConversations: vi.fn(),
    setConversationsLoading: vi.fn(),
    conversationsRequestSeqRef,
    conversationsLoadingRequestSeqRef,
    conversationsLoadingRef,
    conversationsRef,
    conversationsCacheKeyParts: ['chat', 'conversations', 'user-1'],
    conversationsCacheHydratedRef,
    lastConversationsLoadAtRef,
    loadConversationsRef,
    sidebarScrollRef,
  });

  useChatActiveThreadPolling({
    activeConversationId: 'conv-1',
    activeConversationIdRef,
    activeThreadTransportState: socket.activeThreadTransportState,
    buildActiveThreadPollLoadOptions,
    conversationBootstrapComplete: true,
    degradedThreadRevalidateCountRef,
    incrementalPollMs: 60_000,
    lastConversationsLoadAtRef,
    lastForegroundRefreshAtRef,
    listPollMs: 60_000,
    loadConversations: conversations.loadConversations,
    loadMessages: thread.loadMessages,
    loadMessagesRef,
    logChatDebugRef,
    messagesLoadingRef: thread.messagesLoadingRef,
    messagesRef: thread.messagesRef,
    sidebarSearchActive: false,
    shouldPollActiveThreadIncrementally,
    socketStatus: socket.socketStatus,
    threadPollMs: 60_000,
  });

  useChatSocketControllerEvents({
    activeConversation: { id: 'conv-1', kind: 'direct' },
    activeConversationIdRef,
    aiRunStartedAtByConversationRef,
    applyMessageReadDelta: vi.fn(),
    buildActiveThreadPollLoadOptions,
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation: () => false,
    hasPersistedThreadMessageEquivalent,
    lastConversationsLoadAtRef,
    latestActiveThreadSocketMessageRef,
    loadConversations: conversations.loadConversations,
    loadMessages: thread.loadMessages,
    loadMessagesRef,
    logChatDebug: vi.fn(),
    logChatDebugRef,
    markConversationReadLiveRef,
    markSocketActivity: socket.markSocketActivity,
    mergeAiStatusPayload,
    mergeMessageIntoThread: vi.fn(),
    messagesLoadingRef: thread.messagesLoadingRef,
    messagesRef: thread.messagesRef,
    onConversationRemoved: vi.fn(),
    promoteConversationToTop: vi.fn(),
    queueAutoScroll: vi.fn(),
    setAiStatusByConversation: vi.fn(),
    setMessages: thread.setMessages,
    setSocketStatus: socket.setSocketStatus,
    setTypingUsers: socket.setTypingUsers,
    setViewerLastReadAt: thread.setViewerLastReadAt,
    setViewerLastReadMessageId: thread.setViewerLastReadMessageId,
    shouldSkipActiveThreadRevalidate,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    socketStatusRef: socket.socketStatusRef,
    syncConversationPreview: vi.fn(),
    threadNearBottomRef,
    typingParticipantsTimeoutsRef: socket.typingParticipantsTimeoutsRef,
    updatePresenceInCollections: vi.fn(),
    upsertConversation: vi.fn(),
    userId: 1,
  });

  return (
    <div>
      <output data-testid="socket-status">{socket.socketStatus}</output>
      <output data-testid="transport-state">{socket.activeThreadTransportState}</output>
      <output data-testid="message-count">{thread.messages.length}</output>
    </div>
  );
}

describe('chat page socket init + shared loader refs (R1 + R2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSWRCache();
    socketState.value = 'connecting';
    chatAPI.getThreadBootstrap.mockResolvedValue({
      items: [
        { id: 'msg-1', conversation_id: 'conv-1', body: 'hello', created_at: '2026-04-28T08:00:00.000Z' },
      ],
      has_older: false,
      has_newer: false,
    });
    chatAPI.getMessages.mockResolvedValue({
      items: [
        { id: 'msg-2', conversation_id: 'conv-1', body: 'newer', created_at: '2026-04-28T08:01:00.000Z' },
      ],
      has_older: false,
      has_newer: false,
    });
    chatAPI.getConversations.mockResolvedValue({ items: [], has_more: false });
  });

  it('degraded transport polls through the controller-assigned loadMessagesRef', async () => {
    socketState.value = 'disconnected';

    render(<PageWiringHarness />);

    expect(screen.getByTestId('transport-state').textContent).toBe('offline');
    // The immediate degraded poll must reach the real thread loader — the ref
    // was populated by useChatThreadController itself, not by the test.
    await waitFor(() => expect(chatAPI.getThreadBootstrap).toHaveBeenCalledTimes(1));
    expect(chatAPI.getThreadBootstrap).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ lightweight: 1 }),
      expect.anything(),
    );
    await waitFor(() => {
      expect(screen.getByTestId('message-count').textContent).toBe('1');
    });
  });

  it('starts connected when the socket was live before mount and does not poll', async () => {
    socketState.value = 'connected';

    render(<PageWiringHarness />);

    expect(screen.getByTestId('socket-status').textContent).toBe('connected');
    expect(screen.getByTestId('transport-state').textContent).toBe('healthy');
    await act(async () => { await Promise.resolve(); });
    // Healthy transport → the degraded poll never fires on mount.
    expect(chatAPI.getThreadBootstrap).not.toHaveBeenCalled();
    expect(chatAPI.getMessages).not.toHaveBeenCalled();
    expect(chatAPI.getConversations).not.toHaveBeenCalled();
  });

  it('does not lose the first connected transition after a disconnected mount', async () => {
    socketState.value = 'disconnected';

    render(<PageWiringHarness />);
    await waitFor(() => expect(chatAPI.getThreadBootstrap).toHaveBeenCalledTimes(1));
    chatAPI.getMessages.mockClear();
    chatAPI.getConversations.mockClear();

    // The real socket reports 'connected' after the event — keep the mock in
    // sync so a re-run of the mount-sync effect (deps change on re-render)
    // doesn't roll the status back to 'disconnected'.
    socketState.value = 'connected';
    act(() => {
      window.dispatchEvent(new CustomEvent(CHAT_SOCKET_STATUS_EVENT, {
        detail: { status: 'connected' },
      }));
    });

    // The mount-time sync consumed the "initial connect" slot, so this real
    // transition runs the reconnect refresh instead of being swallowed.
    await waitFor(() => expect(screen.getByTestId('socket-status').textContent).toBe('connected'));
    await waitFor(() => expect(chatAPI.getMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ after_message_id: 'msg-1' }),
    ));
    await waitFor(() => expect(chatAPI.getConversations).toHaveBeenCalled());
    expect(screen.getByTestId('transport-state').textContent).toBe('healthy');
  });
});

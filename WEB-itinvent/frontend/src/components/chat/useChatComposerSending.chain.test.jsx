import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chatAPI } from '../../api/client';
import { chatSocket } from '../../lib/chatSocket';
import { clearSWRCache, peekSWRCache, setSWRCache } from '../../lib/swrCache';
import { buildChatThreadCacheKeyParts } from '../../pages/chat/chatCacheKeys';
import {
  buildOptimisticTextMessage,
  isLikelyOptimisticReplacement,
  withStableThreadMessageRenderKey,
} from '../../pages/chat/chatOptimisticMessages';
import useChatConversationSyncCallbacks from '../../pages/chat/useChatConversationSyncCallbacks';
import { buildActiveThreadCachePayload } from '../../pages/chat/useChatSessionPersistenceEffects';
import useChatThreadController from '../../pages/chat/useChatThreadController';
import useChatThreadMessageMerge from '../../pages/chat/useChatThreadMessageMerge';
import { ChatBubble } from './ChatBubble';
import { buildChatUiTokens } from './chatUiTokens';
import useChatComposerSending from './useChatComposerSending';

vi.mock('../../api/client', () => ({
  API_V1_BASE: '/api/v1',
  chatAPI: {
    sendMessage: vi.fn(),
    editChatMessage: vi.fn(),
    sendFiles: vi.fn(),
    getThreadBootstrap: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock('../../lib/chatFeature', () => ({
  CHAT_WS_ENABLED: true,
  CHAT_FEATURE_ENABLED: true,
}));

vi.mock('../../lib/chatSocket', () => ({
  chatSocket: {
    close: vi.fn(),
    isOpen: vi.fn(() => true),
    reconnectNow: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock('../../lib/debugClientLog', () => ({
  emitAgentDebugLog: vi.fn(),
}));

const theme = createTheme();
const ui = buildChatUiTokens(theme);

// Full chain without internal-module substitutes: real useChatComposerSending,
// real upsertThreadMessagesInList/mergeIncomingThreadMessage (through
// useChatThreadMessageMerge), real syncConversationPreview and real ChatBubble.
// Only the transport (chatSocket + chatAPI) is mocked.
function Harness() {
  const [conversations, setConversations] = useState([
    { id: 'conversation-1', kind: 'direct', title: 'Direct' },
  ]);
  const [messages, setMessages] = useState([]);
  const [, setMessageText] = useState('hello');
  const activeConversationIdRef = useRef('conversation-1');
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const draftWriteTimeoutRef = useRef(null);
  const latestMessageTextRef = useRef('hello');
  const socketStatusRef = useRef('connected');
  const failedThreadMessagesRef = useRef(new Map());
  const optimisticSeqRef = useRef(0);

  const syncCallbacks = useChatConversationSyncCallbacks({
    messagesRef,
    patchGroupPresence: vi.fn(),
    patchSearchConversations: vi.fn(),
    patchSearchPersonPresence: vi.fn(),
    setConversationDetailsById: vi.fn(),
    setConversations,
    setMessageReadsItems: vi.fn(),
    setMessages,
    upsertSearchConversation: vi.fn(),
  });

  const merge = useChatThreadMessageMerge({
    activeConversationIdRef,
    isLikelyOptimisticReplacement,
    messagesRef,
    promoteConversationToTop: vi.fn(),
    queueAutoScroll: vi.fn(),
    setMessages,
    setViewerLastReadAt: vi.fn(),
    setViewerLastReadMessageId: vi.fn(),
    syncConversationPreview: syncCallbacks.syncConversationPreview,
    withStableMessageRenderKey: withStableThreadMessageRenderKey,
  });

  const composer = useChatComposerSending({
    activeConversation: { id: 'conversation-1', kind: 'direct', title: 'Direct' },
    activeConversationId: 'conversation-1',
    activeConversationIdRef,
    applyOutgoingThreadMessage: merge.applyOutgoingThreadMessage,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticTextMessage: ({ conversationId, body, bodyFormat, replyPreview }) => (
      buildOptimisticTextMessage({
        conversationId,
        body,
        bodyFormat,
        replyPreview,
        user: { id: 7, username: 'me', full_name: 'Me' },
        seq: (optimisticSeqRef.current += 1),
      })
    ),
    draftWriteTimeoutRef,
    editingMessage: null,
    failedThreadMessagesRef,
    flushDraftToStorage: vi.fn(),
    focusComposer: vi.fn(),
    latestMessageTextRef,
    logChatDebug: vi.fn(),
    mergeMessageIntoThread: merge.mergeMessageIntoThread,
    notifyApiError: vi.fn(),
    readSelectedDatabaseId: () => 'main',
    removeThreadMessage: merge.removeThreadMessage,
    replyMessage: null,
    setEditingMessage: vi.fn(),
    setMessageText,
    setOptimisticAiQueuedStatus: vi.fn(),
    setReplyMessage: vi.fn(),
    socketStatusRef,
    userId: 7,
  });

  const activeConversation = conversations[0];

  return (
    <>
      <button type="button" data-testid="send" onClick={composer.handleComposerSend}>
        send
      </button>
      <output data-testid="messages-debug">
        {JSON.stringify(messages.map((message) => ({
          id: message?.id,
          clientMessageId: message?.client_message_id || null,
          isOptimistic: Boolean(message?.isOptimistic),
          optimisticStatus: message?.optimisticStatus ?? null,
          deliveryStatus: message?.delivery_status ?? null,
        })))}
      </output>
      <output data-testid="preview-debug">
        {JSON.stringify(activeConversation?.last_message_delivery_status ?? null)}
      </output>
      {messages.map((message) => (
        <ChatBubble
          key={String(message?.renderKey || message?.id)}
          conversationKind="direct"
          message={message}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          onRetryFailedMessage={composer.retryFailedMessage}
          onDiscardFailedMessage={composer.discardFailedMessage}
        />
      ))}
    </>
  );
}

const readThreadDebug = () => JSON.parse(screen.getByTestId('messages-debug').textContent || '[]');

describe('useChatComposerSending chain (real merge + real ChatBubble)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatSocket.isOpen.mockReturnValue(true);
  });

  it('shows ⚠ after WS+HTTP failure, retries once with the same client_message_id and replaces the bubble', async () => {
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('ws-down'));
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    render(
      <ThemeProvider theme={theme}>
        <Harness />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('send'));

    // WS transport error → HTTP fallback also fails → the bubble goes failed,
    // not "sending" forever and not silently dropped.
    await screen.findByTestId('chat-message-failed-action');

    const failedRows = readThreadDebug();
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].isOptimistic).toBe(true);
    expect(failedRows[0].optimisticStatus).toBe('failed');
    // No ✓ in the sidebar preview for the failed message.
    await waitFor(() => {
      expect(screen.getByTestId('preview-debug').textContent).toBe('null');
    });
    expect(chatSocket.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);
    const clientMessageId = chatSocket.sendMessage.mock.calls[0][2].client_message_id;
    expect(clientMessageId).toBeTruthy();

    // «Повторить»: socket recovers — exactly one retry request, same
    // client_message_id (idempotent on the server).
    chatSocket.sendMessage.mockResolvedValueOnce({
      ok: true,
      message_id: 'server-9',
      message: {
        id: 'server-9',
        conversation_id: 'conversation-1',
        kind: 'text',
        body: 'hello',
        body_format: 'plain',
        is_own: true,
        delivery_status: 'sent',
        created_at: '2026-03-21T10:00:01Z',
        sender: { id: 7, username: 'me', full_name: 'Me' },
      },
    });

    fireEvent.click(screen.getByTestId('chat-message-failed-action'));
    fireEvent.click(await screen.findByTestId('chat-message-failed-retry'));

    await waitFor(() => expect(chatSocket.sendMessage).toHaveBeenCalledTimes(2));
    const retryCalls = chatSocket.sendMessage.mock.calls.slice(1);
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0][2].client_message_id).toBe(clientMessageId);
    expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.queryByTestId('chat-message-failed-action')).not.toBeInTheDocument();
    });
    const mergedRows = readThreadDebug();
    expect(mergedRows).toHaveLength(1);
    expect(mergedRows[0].id).toBe('server-9');
    expect(mergedRows[0].clientMessageId).toBe(clientMessageId);
    expect(mergedRows[0].isOptimistic).toBe(false);
    expect(mergedRows[0].optimisticStatus).toBeNull();
    expect(screen.getByTestId('preview-debug').textContent).toBe('"sent"');
  });
});

// R12: the failed bubble must survive an A → B → A round-trip through the
// real thread cache (buildActiveThreadCachePayload → SWR →
// applyLatestThreadPayload) and stay retryable with the same
// client_message_id.
function CacheHarness({ onReady }) {
  const [conversations, setConversations] = useState([
    { id: 'conv-a', kind: 'direct', title: 'Direct A' },
    { id: 'conv-b', kind: 'direct', title: 'Direct B' },
  ]);
  const [activeConversationId, setActiveConversationId] = useState('conv-a');
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const failedThreadMessagesRef = useRef(new Map());
  const optimisticSeqRef = useRef(0);
  const latestMessageTextRef = useRef('hello');
  const socketStatusRef = useRef('connected');
  const draftWriteTimeoutRef = useRef(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const autoScrollRef = useRef(false);
  const autoScrollMetaRef = useRef(null);
  const threadNearBottomRef = useRef(true);
  const prependScrollRestoreRef = useRef(null);
  const threadLoadAbortRef = useRef(null);
  const threadPrefetchAbortControllersRef = useRef(new Map());
  const loadOlderInFlightCursorRef = useRef('');
  const showJumpToLatestRef = useRef(false);
  const hydratedThreadConversationIdRef = useRef('');
  const logChatDebugRef = useRef(vi.fn());
  const cancelPendingInitialAnchorRef = useRef(vi.fn());
  const scrollToMessageRef = useRef(() => false);
  const scrollThreadBottomIntoViewRef = useRef(vi.fn());
  const isInitialViewportGuardActiveRef = useRef(() => false);
  const capturePrependScrollRestoreRef = useRef(() => null);
  const resolvePendingInitialAnchorFromPayloadRef = useRef(() => false);
  const hasPendingInitialAnchorForConversationRef = useRef(() => false);
  const syncConversationPreviewRef = useRef(null);
  const loadMessagesRef = useRef(null);

  const controller = useChatThreadController({
    activeConversationId,
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    cancelPendingInitialAnchorRef,
    capturePrependScrollRestoreRef,
    conversationsRef,
    failedThreadMessagesRef,
    hasPendingInitialAnchorForConversationRef,
    hydratedThreadConversationIdRef,
    initialConversationId: 'conv-a',
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

  const syncCallbacks = useChatConversationSyncCallbacks({
    messagesRef: controller.messagesRef,
    patchGroupPresence: vi.fn(),
    patchSearchConversations: vi.fn(),
    patchSearchPersonPresence: vi.fn(),
    setConversationDetailsById: vi.fn(),
    setConversations,
    setMessageReadsItems: vi.fn(),
    setMessages: controller.setMessages,
    upsertSearchConversation: vi.fn(),
  });
  syncConversationPreviewRef.current = syncCallbacks.syncConversationPreview;

  const merge = useChatThreadMessageMerge({
    activeConversationIdRef,
    isLikelyOptimisticReplacement,
    messagesRef: controller.messagesRef,
    promoteConversationToTop: vi.fn(),
    queueAutoScroll: vi.fn(),
    setMessages: controller.setMessages,
    setViewerLastReadAt: controller.setViewerLastReadAt,
    setViewerLastReadMessageId: controller.setViewerLastReadMessageId,
    syncConversationPreview: syncCallbacks.syncConversationPreview,
    withStableMessageRenderKey: withStableThreadMessageRenderKey,
  });

  const activeConversation = conversations.find((item) => item.id === activeConversationId) || null;
  const [, setMessageText] = useState('hello');

  const composer = useChatComposerSending({
    activeConversation,
    activeConversationId,
    activeConversationIdRef,
    applyOutgoingThreadMessage: merge.applyOutgoingThreadMessage,
    buildReplyPreview: () => null,
    cancelPendingInitialAnchor: vi.fn(),
    createOptimisticTextMessage: ({ conversationId, body, bodyFormat, replyPreview }) => (
      buildOptimisticTextMessage({
        conversationId,
        body,
        bodyFormat,
        replyPreview,
        user: { id: 7, username: 'me', full_name: 'Me' },
        seq: (optimisticSeqRef.current += 1),
      })
    ),
    draftWriteTimeoutRef,
    editingMessage: null,
    failedThreadMessagesRef,
    flushDraftToStorage: vi.fn(),
    focusComposer: vi.fn(),
    latestMessageTextRef,
    logChatDebug: vi.fn(),
    mergeMessageIntoThread: merge.mergeMessageIntoThread,
    notifyApiError: vi.fn(),
    readSelectedDatabaseId: () => 'main',
    removeThreadMessage: merge.removeThreadMessage,
    replyMessage: null,
    setEditingMessage: vi.fn(),
    setMessageText,
    setOptimisticAiQueuedStatus: vi.fn(),
    setReplyMessage: vi.fn(),
    socketStatusRef,
    userId: 7,
  });

  const apiRef = useRef(null);
  apiRef.current = {
    composer,
    controller,
    failedThreadMessagesRef,
    setActiveConversationId,
  };
  React.useEffect(() => {
    onReady?.(apiRef.current);
  });

  return (
    <>
      <button type="button" data-testid="send" onClick={composer.handleComposerSend}>
        send
      </button>
      <output data-testid="messages-debug">
        {JSON.stringify(controller.messages.map((message) => ({
          id: message?.id,
          clientMessageId: message?.client_message_id || null,
          isOptimistic: Boolean(message?.isOptimistic),
          optimisticStatus: message?.optimisticStatus ?? null,
        })))}
      </output>
      {controller.messages.map((message) => (
        <ChatBubble
          key={String(message?.renderKey || message?.id)}
          conversationKind="direct"
          message={message}
          navigate={vi.fn()}
          theme={theme}
          ui={ui}
          onOpenReads={vi.fn()}
          onOpenAttachmentPreview={vi.fn()}
          onReplyMessage={vi.fn()}
          onRetryFailedMessage={composer.retryFailedMessage}
          onDiscardFailedMessage={composer.discardFailedMessage}
        />
      ))}
    </>
  );
}

const cacheThreadForConversation = (api, conversationId) => {
  setSWRCache(
    buildChatThreadCacheKeyParts('user-1', conversationId),
    buildActiveThreadCachePayload({
      messages: api.controller.messages,
      messagesHasMore: api.controller.messagesHasMore,
      messagesHasNewer: api.controller.messagesHasNewer,
      viewerLastReadMessageId: api.controller.viewerLastReadMessageId,
      viewerLastReadAt: api.controller.viewerLastReadAt,
    }),
  );
};

const reloadThreadFromCache = async (api, conversationId) => {
  const entry = peekSWRCache(buildChatThreadCacheKeyParts('user-1', conversationId));
  expect(entry?.data).toBeTruthy();
  await act(async () => {
    api.controller.applyLatestThreadPayload(conversationId, entry.data);
  });
  return entry.data;
};

describe('R12: failed bubble stays retryable across A → B → A with SWR cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSWRCache();
    chatSocket.isOpen.mockReturnValue(true);
  });

  it('text: retry after a cached round-trip sends one request with the original client_message_id', async () => {
    chatSocket.sendMessage.mockRejectedValueOnce(new Error('ws-down'));
    chatAPI.sendMessage.mockRejectedValueOnce(new Error('503'));

    let api = null;
    render(
      <ThemeProvider theme={theme}>
        <CacheHarness onReady={(value) => { api = value; }} />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('send'));
    await screen.findByTestId('chat-message-failed-action');
    const clientMessageId = chatSocket.sendMessage.mock.calls[0][2].client_message_id;
    expect(clientMessageId).toBeTruthy();
    const failedRows = readThreadDebug();
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].optimisticStatus).toBe('failed');
    expect(failedThreadRegistrySize(api, 'conv-a')).toBe(1);

    // Leaving A persists the active thread into the SWR cache; optimistic
    // bubbles must not be written there.
    cacheThreadForConversation(api, 'conv-a');
    const cached = peekSWRCache(buildChatThreadCacheKeyParts('user-1', 'conv-a'));
    expect(cached?.data?.items?.some((item) => item?.isOptimistic || item?.optimisticStatus)).toBe(false);

    await act(async () => { api.setActiveConversationId('conv-b'); });
    await act(async () => {
      api.controller.applyLatestThreadPayload('conv-b', {
        items: [
          { id: 'msg-b1', conversation_id: 'conv-b', body: 'b', created_at: '2026-03-21T10:00:02Z' },
        ],
        has_older: false,
      });
    });
    await waitFor(() => {
      expect(readThreadDebug().map((row) => row.id)).toEqual(['msg-b1']);
    });

    // Back to A: the registry entry must survive the cached payload apply —
    // the failed bubble is restored by the registry, not the cache.
    await act(async () => { api.setActiveConversationId('conv-a'); });
    await reloadThreadFromCache(api, 'conv-a');
    await screen.findByTestId('chat-message-failed-action');
    expect(failedThreadRegistrySize(api, 'conv-a')).toBe(1);

    chatSocket.sendMessage.mockResolvedValueOnce({
      ok: true,
      message_id: 'server-10',
      message: {
        id: 'server-10',
        conversation_id: 'conv-a',
        kind: 'text',
        body: 'hello',
        body_format: 'plain',
        is_own: true,
        delivery_status: 'sent',
        created_at: '2026-03-21T10:00:03Z',
        sender: { id: 7, username: 'me', full_name: 'Me' },
        client_message_id: clientMessageId,
      },
    });

    fireEvent.click(screen.getByTestId('chat-message-failed-action'));
    fireEvent.click(await screen.findByTestId('chat-message-failed-retry'));

    await waitFor(() => expect(chatSocket.sendMessage).toHaveBeenCalledTimes(2));
    expect(chatSocket.sendMessage.mock.calls[1][2].client_message_id).toBe(clientMessageId);
    expect(chatAPI.sendMessage).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      const rows = readThreadDebug();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('server-10');
      expect(rows[0].isOptimistic).toBe(false);
    });
  });

  it('album: a failed file bubble retries via sendFiles with the same client_message_id after A → B → A', async () => {
    let api = null;
    render(
      <ThemeProvider theme={theme}>
        <CacheHarness onReady={(value) => { api = value; }} />
      </ThemeProvider>,
    );

    const optimisticAlbum = {
      id: 'optimistic:album-1',
      conversation_id: 'conv-a',
      kind: 'file',
      client_message_id: 'cm-album-1',
      body: '',
      is_own: true,
      isOptimistic: true,
      optimisticStatus: 'sending',
      created_at: '2026-03-21T10:01:00Z',
      sender: { id: 7, username: 'me', full_name: 'Me' },
      attachments: [
        {
          id: 'att-1',
          file_name: 'photo-1.png',
          mime_type: 'image/png',
          kind: 'image',
          width: 320,
          height: 240,
          preview_url: 'blob:photo-1',
        },
        {
          id: 'att-2',
          file_name: 'photo-2.png',
          mime_type: 'image/png',
          kind: 'image',
          width: 320,
          height: 240,
          preview_url: 'blob:photo-2',
        },
      ],
    };
    const uploadItems = [{ name: 'photo-1.png' }, { name: 'photo-2.png' }];

    await act(async () => {
      api.composer.registerFailedOutgoingMessage('conv-a', optimisticAlbum, {
        fileResend: { uploadItems },
      });
    });
    await screen.findByTestId('chat-message-failed-action');
    expect(failedThreadRegistrySize(api, 'conv-a')).toBe(1);

    cacheThreadForConversation(api, 'conv-a');
    await act(async () => { api.setActiveConversationId('conv-b'); });
    await act(async () => {
      api.controller.applyLatestThreadPayload('conv-b', {
        items: [
          { id: 'msg-b1', conversation_id: 'conv-b', body: 'b', created_at: '2026-03-21T10:00:02Z' },
        ],
        has_older: false,
      });
    });
    await act(async () => { api.setActiveConversationId('conv-a'); });
    await reloadThreadFromCache(api, 'conv-a');
    await screen.findByTestId('chat-message-failed-action');
    expect(failedThreadRegistrySize(api, 'conv-a')).toBe(1);

    chatAPI.sendFiles.mockResolvedValueOnce({
      id: 'server-album-1',
      conversation_id: 'conv-a',
      kind: 'file',
      client_message_id: 'cm-album-1',
      is_own: true,
      delivery_status: 'sent',
      created_at: '2026-03-21T10:01:30Z',
      sender: { id: 7, username: 'me', full_name: 'Me' },
      attachments: optimisticAlbum.attachments,
    });

    fireEvent.click(screen.getByTestId('chat-message-failed-action'));
    fireEvent.click(await screen.findByTestId('chat-message-failed-retry'));

    await waitFor(() => expect(chatAPI.sendFiles).toHaveBeenCalledTimes(1));
    expect(chatAPI.sendFiles.mock.calls[0][0]).toBe('conv-a');
    expect(chatAPI.sendFiles.mock.calls[0][1]).toBe(uploadItems);
    expect(chatAPI.sendFiles.mock.calls[0][2].client_message_id).toBe('cm-album-1');

    await waitFor(() => {
      const rows = readThreadDebug();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('server-album-1');
      expect(rows[0].isOptimistic).toBe(false);
    });
    expect(failedThreadRegistrySize(api, 'conv-a')).toBe(0);
  });
});

const failedThreadRegistrySize = (api, conversationId) => (
  api.failedThreadMessagesRef.current.get(conversationId)?.size || 0
);

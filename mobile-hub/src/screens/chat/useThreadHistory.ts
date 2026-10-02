import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as chatApi from '../../api/chatApi';
import type { ChatAiBot, ChatConversationSummary, ChatMessage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import { readNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { isAiConversation } from '../../chat/chatAiWorkspace';
import {
  findLatestIncomingMessage,
  getUnreadBoundaryMessageId,
  mergeMessages,
  resolveChatMessageIsOwn,
} from '../../chat/chatState';
import { chatMessageMotionKey, type ChatMessageEnterKind } from '../../components/chat/ChatMessageEnterMotion';
import { showNativeToast } from '../../components/nativeToast';
import { setPinnedChatMessageId } from '../../chat/chatPinnedMessages';
import {
  mergeNativeChatThreadHistory,
  scheduleNativeChatThreadSnapshotWrite,
  type NativeChatThreadSnapshot,
} from '../../chat/nativeChatThreadHistory';
import type { createNativeChatOutbox } from '../../chat/nativeChatOutbox';
import type { ChatListAnchorReason } from '../../chat/chatListAnchor';
import type { PendingAttachmentUpload } from './NativeChatThreadScreen';

type ThreadOutbox = ReturnType<typeof createNativeChatOutbox>;

/** Thread history: initial/cached load, older/newer pagination, snapshot writes,
 * and the post-reconnect catch-up that keeps the durable window continuous. */
export function useThreadHistory({
  conversationId,
  userId,
  messageId,
  offlineMode,
  historySessionGeneration,
  mountedRef,
  nearBottomRef,
  knownMessageIdsRef,
  messageAnimationReadyRef,
  messageEnterMotionsRef,
  serverPinKnownRef,
  leaveInFlightRef,
  pendingAttachmentUploadsRef,
  messagesRef,
  outbox,
  markRead,
  requestBottomAnchor,
  conversation,
  title,
  messages,
  pinnedMessageId,
  focusAnchorId,
  unreadBoundaryId,
  setMessages,
  setConversation,
  setTitle,
  setUnreadBoundaryId,
  setFocusAnchorId,
  setPinnedMessageId,
  setShowJumpToBottom,
  setNewMessageCount,
  setHoldVisiblePosition,
  setAiBots,
  setDraftError,
}: {
  conversationId: string;
  userId?: number;
  messageId?: string;
  offlineMode: boolean;
  historySessionGeneration: number;
  mountedRef: MutableRefObject<boolean>;
  nearBottomRef: MutableRefObject<boolean>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  messageAnimationReadyRef: MutableRefObject<boolean>;
  messageEnterMotionsRef: MutableRefObject<Map<string, ChatMessageEnterKind>>;
  serverPinKnownRef: MutableRefObject<boolean>;
  leaveInFlightRef: MutableRefObject<boolean>;
  pendingAttachmentUploadsRef: MutableRefObject<Map<string, PendingAttachmentUpload>>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  outbox: ThreadOutbox;
  markRead: (latest?: ChatMessage | null) => void;
  requestBottomAnchor: (reason?: ChatListAnchorReason) => void;
  conversation: ChatConversationSummary | null;
  title: string;
  messages: ChatMessage[];
  pinnedMessageId: string | null;
  focusAnchorId: string | null;
  unreadBoundaryId: string | null;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setConversation: Dispatch<SetStateAction<ChatConversationSummary | null>>;
  setTitle: Dispatch<SetStateAction<string>>;
  setUnreadBoundaryId: Dispatch<SetStateAction<string | null>>;
  setFocusAnchorId: Dispatch<SetStateAction<string | null>>;
  setPinnedMessageId: Dispatch<SetStateAction<string | null>>;
  setShowJumpToBottom: Dispatch<SetStateAction<boolean>>;
  setNewMessageCount: Dispatch<SetStateAction<number>>;
  setHoldVisiblePosition: Dispatch<SetStateAction<boolean>>;
  setAiBots: Dispatch<SetStateAction<ChatAiBot[]>>;
  setDraftError: Dispatch<SetStateAction<string>>;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [threadHydrated, setThreadHydrated] = useState(false);
  const [historyUnavailableOffline, setHistoryUnavailableOffline] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const historyNavigationRef = useRef(0);
  const accumulatedMessagesRef = useRef<ChatMessage[]>([]);
  const historyMayHaveGapsRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const reconnectSyncRef = useRef<number | null>(null);
  const loadedThreadScopeRef = useRef('');
  // T13: non-local window entries collected since the last snapshot flush.
  // The accumulated merge runs once per flush instead of per messages change.
  const pendingWindowRef = useRef<Map<string, ChatMessage>>(new Map());

  useEffect(() => {
    leaveInFlightRef.current = false;
    loadGenerationRef.current += 1;
    accumulatedMessagesRef.current = [];
    historyMayHaveGapsRef.current = false;
    loadedThreadScopeRef.current = '';
    pendingWindowRef.current = new Map();
    setThreadHydrated(false);
    setMessages([]);
    setConversation(null);
    setTitle('Chat');
    setHoldVisiblePosition(false);
  }, [conversationId, userId, leaveInFlightRef, setConversation, setHoldVisiblePosition, setMessages, setTitle]);

  const loadInitial = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    historyNavigationRef.current += 1;
    loadingOlderRef.current = false;
    loadingNewerRef.current = false;
    setLoadingOlder(false);
    // T7: a superseded loadOlder can leave the hold flag stranded — every
    // navigation path that resets the window releases it explicitly.
    setHoldVisiblePosition(false);
    const scopeUserId = Number(userId || 0);
    const scopeConversationId = conversationId;
    const isCurrentLoad = () => (
      mountedRef.current
      && loadGenerationRef.current === generation
      && Number(userId || 0) === scopeUserId
      && conversationId === scopeConversationId
    );
    messageAnimationReadyRef.current = false;
    setLoading(true);
    setError('');
    setHistoryUnavailableOffline(false);
    let hadCachedSnapshot = false;
    let loadedLiveMessages = false;
    try {
      const snapshotPromise = scopeUserId
        ? readNativeEntitySnapshot<NativeChatThreadSnapshot>(
          'chat-thread-details',
          scopeUserId,
          conversationId,
          Number.MAX_SAFE_INTEGER,
        )
        : Promise.resolve(null);
      // Start the network page before local reads finish; offline mode still
      // performs zero requests.
      const pagePromise = offlineMode
        ? null
        : messageId
          ? chatApi.getThreadBootstrap(conversationId, {
            focusMessageId: messageId,
            limit: 80,
            lightweight: false,
          })
          // M7: thread-bootstrap without an explicit focus resolves to the
          // viewer's first-unread anchor on the backend (when a real unread
          // backlog exists) or to the bottom otherwise. An older backend
          // without the endpoint degrades to the plain latest page.
          : chatApi.getThreadBootstrap(conversationId, { limit: 80, lightweight: false })
            .catch(() => chatApi.getMessagesPage(conversationId, { limit: 80 }));
      // A cancelled load may return before ever awaiting the page request.
      void pagePromise?.catch(() => undefined);
      const conversationResultPromise = offlineMode
        ? null
        : chatApi.getConversation(conversationId).then(
          (value) => ({ value, error: null as unknown }),
          (error: unknown) => ({ value: null, error }),
        );
      const cached = await snapshotPromise;
      if (!isCurrentLoad()) return;
      if (cached) {
        hadCachedSnapshot = true;
        const normalized = mergeMessages([], cached.data.messages || [], userId);
        accumulatedMessagesRef.current = normalized;
        historyMayHaveGapsRef.current = Boolean(cached.data.historyMayHaveGaps);
        knownMessageIdsRef.current = new Set(normalized.map((entry) => entry.id));
        setMessages((current) => mergeMessages(normalized, current, userId));
        setConversation(cached.data.conversation || null);
        setTitle(cached.data.title || cached.data.conversation?.title || 'Chat');
        setHasOlder(Boolean(cached.data.hasOlder));
        setOlderCursor(cached.data.olderCursor || null);
        setHasNewer(Boolean(cached.data.hasNewer));
        setNewerCursor(cached.data.newerCursor || null);
        setUnreadBoundaryId(cached.data.unreadBoundaryId || null);
        setFocusAnchorId(messageId || cached.data.focusAnchorId || null);
        setPinnedMessageId(cached.data.pinnedMessageId || null);
        nearBottomRef.current = !cached.data.hasNewer;
        setShowJumpToBottom(Boolean(cached.data.hasNewer));
        setNewMessageCount(0);
        messageAnimationReadyRef.current = true;
        loadedThreadScopeRef.current = JSON.stringify([scopeUserId, scopeConversationId]);
        setThreadHydrated(true);
        setLoading(false);
      }
      try {
        const [queued, uploads] = await Promise.all([outbox.read(), outbox.readUploads()]);
        if (!isCurrentLoad()) return;
        uploads.forEach(({ id, upload }) => pendingAttachmentUploadsRef.current.set(id, upload));
        setMessages((current) => {
          const merged = mergeMessages(queued, current, scopeUserId);
          accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
            accumulatedMessagesRef.current,
            merged,
            scopeUserId,
          );
          return merged;
        });
      } catch {
        if (isCurrentLoad()) setDraftError('Не удалось восстановить исходящие сообщения. Откройте диалог снова, чтобы повторить.');
      }
      if (offlineMode) {
        if (!hadCachedSnapshot && isCurrentLoad()) {
          setHistoryUnavailableOffline(true);
        }
        return;
      }

      const page = await pagePromise!;
      if (!isCurrentLoad()) return;
      loadedLiveMessages = true;
      const normalized = mergeMessages([], page.items, userId);
      void outbox.acknowledge(normalized).catch(() => undefined);
      setMessages((current) => {
        const merged = mergeMessages(current, normalized, userId);
        knownMessageIdsRef.current = new Set(merged.map((entry) => entry.id));
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          merged,
          userId,
        );
        historyMayHaveGapsRef.current = Boolean(page.has_older || page.has_newer || historyMayHaveGapsRef.current);
        return merged;
      });
      messageAnimationReadyRef.current = true;
      loadedThreadScopeRef.current = JSON.stringify([scopeUserId, scopeConversationId]);
      setThreadHydrated(true);
      setLoading(false);
      const rawPinnedMessageId = 'pinned_message_id' in page
        ? (page as { pinned_message_id?: string | null }).pinned_message_id
        : undefined;
      if (rawPinnedMessageId !== undefined) {
        const serverPinnedMessageId = String(rawPinnedMessageId || '').trim() || null;
        serverPinKnownRef.current = true;
        setPinnedMessageId(serverPinnedMessageId);
        if (scopeUserId) void setPinnedChatMessageId(scopeUserId, conversationId, serverPinnedMessageId).catch(() => undefined);
      }
      const anchorMode = 'initial_anchor_mode' in page
        ? page.initial_anchor_mode
        : undefined;
      const anchorMessageId = 'initial_anchor_message_id' in page
        ? String(page.initial_anchor_message_id || '').trim()
        : '';
      // A first_unread bootstrap anchor IS the unread boundary; without it the
      // boundary derives from the viewer's last-read marker as before.
      setUnreadBoundaryId(
        anchorMode === 'first_unread' && anchorMessageId
          ? anchorMessageId
          : getUnreadBoundaryMessageId(normalized, page.viewer_last_read_message_id),
      );
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      setFocusAnchorId(anchorMessageId || messageId || null);
      nearBottomRef.current = !page.has_newer;
      setShowJumpToBottom(page.has_newer);
      setNewMessageCount(0);
      if (!page.has_newer) {
        requestBottomAnchor();
        markRead(findLatestIncomingMessage(normalized, userId));
      }

      const conversationResult = await conversationResultPromise!;
      if (!isCurrentLoad()) return;
      if (conversationResult.value) {
        const liveConversation = conversationResult.value;
        setConversation(liveConversation);
        setTitle(liveConversation.title || 'Chat');
        if (liveConversation.pinned_message_id !== undefined) {
          const serverPinnedMessageId = String(liveConversation.pinned_message_id || '').trim() || null;
          serverPinKnownRef.current = true;
          setPinnedMessageId(serverPinnedMessageId);
          if (scopeUserId) void setPinnedChatMessageId(scopeUserId, conversationId, serverPinnedMessageId).catch(() => undefined);
        }
        if (isAiConversation(liveConversation)) {
          void chatApi.getAiBots().then((bots) => {
            if (isCurrentLoad()) setAiBots(bots);
          }).catch(() => undefined);
        }
      }
    } catch (cause) {
      if (isCurrentLoad() && !hadCachedSnapshot && !loadedLiveMessages) {
        if (offlineMode) {
          setHistoryUnavailableOffline(true);
        } else {
          setError(formatApiError(cause, 'Не удалось загрузить сообщения'));
        }
      }
    } finally {
      if (isCurrentLoad()) setLoading(false);
    }
  }, [conversationId, markRead, messageId, mountedRef, nearBottomRef, offlineMode, outbox,
    requestBottomAnchor, userId]);

  const pendingHistoryWriteRef = useRef<{
    userId: number; conversationId: string; generation: number;
    snapshot: Omit<NativeChatThreadSnapshot, 'messages'>;
  } | null>(null);
  const flushHistoryWrite = useCallback(() => {
    const pending = pendingHistoryWriteRef.current;
    if (!pending) return;
    pendingHistoryWriteRef.current = null;
    // T13: fold every window state collected since the previous flush into the
    // durable history — the merge+sort no longer runs on each messages change.
    const pendingWindow = pendingWindowRef.current;
    pendingWindowRef.current = new Map();
    if (pendingWindow.size) {
      accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
        accumulatedMessagesRef.current, [...pendingWindow.values()], pending.userId,
      );
    }
    void scheduleNativeChatThreadSnapshotWrite(pending.userId, pending.conversationId,
      { ...pending.snapshot, messages: [...accumulatedMessagesRef.current] },
      { generation: pending.generation, currentUserId: pending.userId });
  }, [accumulatedMessagesRef]);
  useEffect(() => {
    const owner = Number(userId || 0);
    if (!threadHydrated || historyUnavailableOffline || owner <= 0
      || loadedThreadScopeRef.current !== JSON.stringify([owner, conversationId])) return;
    messages.forEach((message) => {
      if (!message.local_status) pendingWindowRef.current.set(message.id, message);
    });
    pendingHistoryWriteRef.current = {
      userId: owner, conversationId, generation: historySessionGeneration,
      snapshot: { conversation, title,
        hasOlder, olderCursor, hasNewer, newerCursor, unreadBoundaryId,
        focusAnchorId, pinnedMessageId,
        historyMayHaveGaps: historyMayHaveGapsRef.current || hasOlder || hasNewer },
    };
    const timer = setTimeout(flushHistoryWrite, 250);
    return () => clearTimeout(timer);
  }, [conversation, conversationId, focusAnchorId, hasNewer, hasOlder, messages,
    newerCursor, olderCursor, pinnedMessageId, threadHydrated, historyUnavailableOffline,
    title, unreadBoundaryId, userId, historySessionGeneration, flushHistoryWrite]);
  useEffect(() => () => { flushHistoryWrite(); }, [conversationId, userId, flushHistoryWrite]);

  const loadOlder = useCallback(async () => {
    if (offlineMode || !hasOlder || !olderCursor || loadingOlderRef.current) return;
    const generation = loadGenerationRef.current;
    const navigation = historyNavigationRef.current;
    const isCurrentHistory = () => mountedRef.current
      && generation === loadGenerationRef.current
      && navigation === historyNavigationRef.current;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await chatApi.getMessagesPage(conversationId, {
        beforeMessageId: olderCursor,
        limit: 80,
      });
      if (!isCurrentHistory()) return;
      if (page.cursor_invalid) {
        await loadInitial();
        return;
      }
      page.items.forEach((item) => knownMessageIdsRef.current.add(item.id));
      setHoldVisiblePosition(true);
      setMessages((current) => {
        const merged = mergeMessages(current, page.items, userId);
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          page.items,
          userId,
        );
        historyMayHaveGapsRef.current = Boolean(historyMayHaveGapsRef.current || page.has_older);
        return merged;
      });
      setHasOlder(page.has_older);
      setOlderCursor(page.older_cursor_message_id);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // T7: release the hold even when a search jump/jumpToBottom already
          // bumped historyNavigationRef — otherwise the flag (and
          // maintainVisibleContentPosition) stays on for the whole session.
          if (mountedRef.current) setHoldVisiblePosition(false);
        });
      });
    } catch (cause) {
      if (isCurrentHistory()) {
        // T6: the error block only renders for an empty list; with messages
        // already on screen the failure surfaces as a toast.
        const text = formatApiError(cause, 'Не удалось загрузить предыдущие сообщения');
        setError(text);
        showNativeToast(text);
      }
    } finally {
      if (isCurrentHistory()) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [conversationId, hasOlder, loadInitial, mountedRef, offlineMode, olderCursor, userId]);

  const loadNewer = useCallback(async () => {
    if (offlineMode || !hasNewer || !newerCursor || loadingNewerRef.current) return;
    const generation = loadGenerationRef.current;
    const navigation = historyNavigationRef.current;
    const isCurrentHistory = () => mountedRef.current
      && generation === loadGenerationRef.current
      && navigation === historyNavigationRef.current;
    loadingNewerRef.current = true;
    try {
      const page = await chatApi.getMessagesPage(conversationId, {
        afterMessageId: newerCursor,
        limit: 80,
      });
      if (!isCurrentHistory()) return;
      if (page.cursor_invalid) {
        await loadInitial();
        return;
      }
      page.items.forEach((item) => knownMessageIdsRef.current.add(item.id));
      setMessages((current) => {
        const merged = mergeMessages(current, page.items, userId);
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current,
          page.items,
          userId,
        );
        historyMayHaveGapsRef.current = Boolean(historyMayHaveGapsRef.current || page.has_newer);
        return merged;
      });
      setHasNewer(page.has_newer);
      setNewerCursor(page.newer_cursor_message_id);
      if (!page.has_newer) {
        nearBottomRef.current = true;
        setShowJumpToBottom(false);
        setNewMessageCount(0);
        markRead(findLatestIncomingMessage(mergeMessages([], page.items, userId), userId));
      }
    } catch (cause) {
      if (isCurrentHistory()) {
        // T6: same as loadOlder — a non-empty list never renders `error`.
        const text = formatApiError(cause, 'Не удалось загрузить новые сообщения');
        setError(text);
        showNativeToast(text);
      }
    } finally {
      if (isCurrentHistory()) loadingNewerRef.current = false;
    }
  }, [conversationId, hasNewer, loadInitial, markRead, mountedRef, nearBottomRef, newerCursor, offlineMode, userId]);

  const syncLatestMessages = useCallback(async () => {
    const generation = loadGenerationRef.current;
    const navigation = historyNavigationRef.current;
    const previousWindow = messagesRef.current.filter((message) => !message.local_status);
    const previousIds = new Set(previousWindow.map((message) => message.id));
    if (offlineMode || reconnectSyncRef.current === generation) return;
    reconnectSyncRef.current = generation;
    try {
      const page = await chatApi.getMessagesPage(conversationId, { limit: 80 });
      if (!mountedRef.current || loadGenerationRef.current !== generation
        || historyNavigationRef.current !== navigation) return;
      const latestIds = new Set(page.items.map((message) => message.id));
      const latestWindow = mergeMessages([], page.items, userId);
      const oldestLatest = latestWindow[latestWindow.length - 1];
      const olderWindowHead = previousWindow.find((message) => !latestIds.has(message.id));
      // A fresh WS message may already overlap the top of this REST page. Only
      // an overlap at its older boundary connects the old window to the new one.
      const disconnectedWindow = page.has_older && olderWindowHead && oldestLatest
        && !previousWindow.some((message) => message.id === oldestLatest.id);
      if (disconnectedWindow) {
        historyMayHaveGapsRef.current = true;
        accumulatedMessagesRef.current = mergeNativeChatThreadHistory(
          accumulatedMessagesRef.current, page.items, userId,
        );
        if (!nearBottomRef.current) {
          // Keep the reader's window continuous. Forward pagination fills the gap.
          // T11: mark the fetched ids as known — the early return below skips
          // the loop that does it, and a duplicated WS delivery would
          // otherwise count them as new (badge + enter-motion).
          page.items.forEach((message) => knownMessageIdsRef.current.add(message.id));
          setHasNewer(true);
          setNewerCursor(olderWindowHead.id);
          setMessages((current) => current.filter((message) => message.local_status || !latestIds.has(message.id)));
          setShowJumpToBottom(true);
          return;
        }
        // At the bottom show the latest page, with its own older boundary. Merging
        // disconnected windows would make missing messages unreachable by scrolling.
        historyNavigationRef.current += 1;
        loadingOlderRef.current = false;
        loadingNewerRef.current = false;
        setLoadingOlder(false);
        setHasOlder(page.has_older);
        setOlderCursor(page.older_cursor_message_id);
        setHasNewer(page.has_newer);
        setNewerCursor(page.newer_cursor_message_id);
      }
      page.items.forEach((message) => {
        const isNew = !knownMessageIdsRef.current.has(message.id);
        if (
          messageAnimationReadyRef.current
          && nearBottomRef.current
          && isNew
          && resolveChatMessageIsOwn(message, userId) !== true
        ) {
          messageEnterMotionsRef.current.set(chatMessageMotionKey(message), 'incoming');
        }
        knownMessageIdsRef.current.add(message.id);
      });
      setMessages((current) => mergeMessages(
        disconnectedWindow ? current.filter((message) => message.local_status || !previousIds.has(message.id)) : current,
        page.items, userId,
      ));
      if (nearBottomRef.current && !page.has_newer) {
        requestBottomAnchor('incoming');
        markRead(findLatestIncomingMessage(mergeMessages([], page.items, userId), userId));
      }
    } catch {
      // The reconnect banner remains the source of truth; the next reconnect/focus retries the catch-up.
    } finally {
      if (reconnectSyncRef.current === generation) reconnectSyncRef.current = null;
    }
  }, [conversationId, markRead, mountedRef, nearBottomRef, offlineMode, requestBottomAnchor, userId]);

  return {
    loading,
    error,
    setError,
    threadHydrated,
    historyUnavailableOffline,
    loadingOlder,
    hasNewer,
    newerCursor,
    hasOlder,
    olderCursor,
    loadGenerationRef,
    historyNavigationRef,
    accumulatedMessagesRef,
    historyMayHaveGapsRef,
    loadingOlderRef,
    loadingNewerRef,
    reconnectSyncRef,
    loadedThreadScopeRef,
    setLoadingOlder,
    setThreadHydrated,
    setHasNewer,
    setNewerCursor,
    setHasOlder,
    setOlderCursor,
    loadInitial,
    loadOlder,
    loadNewer,
    syncLatestMessages,
    flushHistoryWrite,
  };
}

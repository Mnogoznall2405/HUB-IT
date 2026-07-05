import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import useChatSocketEvents from '../../components/chat/useChatSocketEvents';
import useChatSocketLifecycle from '../../components/chat/useChatSocketLifecycle';
import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';
import { resolveActiveThreadTransportState } from './chatThreadTransport';

export const SOCKET_ACTIVITY_COALESCE_MS = 10_000;

export default function useChatSocketController({
  activeConversationId,
  deferredMessageText,
  logChatDebugRef,
  watchedPresenceUserIds,
  watchedPresenceUserIdsKey,
}) {
  const socketStatusRef = useRef(CHAT_WS_ENABLED ? 'connecting' : 'disabled');
  const lastSocketActivityAtRef = useRef(0);
  const typingStartedRef = useRef(false);
  const typingStopTimeoutRef = useRef(null);
  const typingParticipantsTimeoutsRef = useRef(new Map());

  const [socketStatus, setSocketStatus] = useState(CHAT_WS_ENABLED ? 'connecting' : 'disabled');
  const [lastSocketActivityAt, setLastSocketActivityAt] = useState(0);
  const [typingUsers, setTypingUsers] = useState([]);

  socketStatusRef.current = socketStatus;

  const markSocketActivity = useCallback((source = 'socket:event') => {
    const nextTimestamp = Date.now();
    lastSocketActivityAtRef.current = nextTimestamp;
    setLastSocketActivityAt((current) => {
      const previous = Number(current || 0);
      if (previous > 0 && (nextTimestamp - previous) < SOCKET_ACTIVITY_COALESCE_MS) {
        return current;
      }
      return nextTimestamp;
    });
    logChatDebugRef.current?.('socket:activity', {
      source: String(source || '').trim() || 'socket:event',
      lastSocketActivityAt: nextTimestamp,
    });
  }, [logChatDebugRef]);

  const activeThreadTransportState = useMemo(
    () => resolveActiveThreadTransportState({
      activeConversationId,
      socketStatus,
      lastSocketActivityAt,
    }),
    [activeConversationId, lastSocketActivityAt, socketStatus],
  );

  const typingLine = useMemo(
    () => (typingUsers.length > 0 ? `${typingUsers.join(', ')} печатает...` : ''),
    [typingUsers],
  );

  useChatSocketLifecycle({
    watchedPresenceUserIds,
    watchedPresenceUserIdsKey,
  });

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    if (!activeConversationId) {
      setTypingUsers([]);
      return undefined;
    }
    chatSocket.subscribeConversation(activeConversationId);
    return () => {
      if (typingStartedRef.current) {
        chatSocket.sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
      chatSocket.unsubscribeConversation(activeConversationId);
      setTypingUsers([]);
    };
  }, [activeConversationId]);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED || !activeConversationId) return undefined;
    const normalizedMessageText = String(deferredMessageText || '').trim();
    if (!normalizedMessageText) {
      if (typingStartedRef.current) {
        chatSocket.sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      return undefined;
    }
    if (!typingStartedRef.current) {
      chatSocket.sendTyping(activeConversationId, true);
      typingStartedRef.current = true;
    }
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStopTimeoutRef.current = window.setTimeout(() => {
      chatSocket.sendTyping(activeConversationId, false);
      typingStartedRef.current = false;
      typingStopTimeoutRef.current = null;
    }, 1800);
    return () => {
      if (typingStopTimeoutRef.current) {
        window.clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      if (typingStartedRef.current) {
        chatSocket.sendTyping(activeConversationId, false);
        typingStartedRef.current = false;
      }
    };
  }, [activeConversationId, deferredMessageText]);

  useEffect(() => () => {
    if (typingStopTimeoutRef.current) {
      window.clearTimeout(typingStopTimeoutRef.current);
    }
    typingStartedRef.current = false;
    typingParticipantsTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    typingParticipantsTimeoutsRef.current.clear();
  }, []);

  return {
    activeThreadTransportState,
    lastSocketActivityAt,
    lastSocketActivityAtRef,
    markSocketActivity,
    setLastSocketActivityAt,
    setSocketStatus,
    setTypingUsers,
    socketStatus,
    socketStatusRef,
    typingLine,
    typingParticipantsTimeoutsRef,
    typingStartedRef,
    typingStopTimeoutRef,
    typingUsers,
  };
}

export function useChatSocketControllerEvents({
  activeConversation,
  activeConversationIdRef,
  aiRunStartedAtByConversationRef,
  applyMessageReadDelta,
  buildActiveThreadPollLoadOptions,
  conversationsLoadingRef,
  hasPendingInitialAnchorForConversation,
  hasPersistedThreadMessageEquivalent,
  lastConversationsLoadAtRef,
  latestActiveThreadSocketMessageRef,
  loadConversations,
  loadMessages,
  loadMessagesRef,
  logChatDebug,
  logChatDebugRef,
  markConversationReadLiveRef,
  markSocketActivity,
  mergeAiStatusPayload,
  mergeMessageIntoThread,
  messagesLoadingRef,
  messagesRef,
  onConversationRemoved,
  promoteConversationToTop,
  queueAutoScroll,
  setAiStatusByConversation,
  setMessages,
  setSocketStatus,
  setTypingUsers,
  setViewerLastReadAt,
  setViewerLastReadMessageId,
  shouldSkipActiveThreadRevalidate,
  skippedInitialSnapshotRefreshRef,
  skippedInitialSocketRefreshRef,
  socketStatusRef,
  syncConversationPreview,
  threadNearBottomRef,
  typingParticipantsTimeoutsRef,
  updatePresenceInCollections,
  upsertConversation,
  userId,
}) {
  useChatSocketEvents({
    activeConversation,
    activeConversationIdRef,
    aiRunStartedAtByConversationRef,
    applyMessageReadDelta,
    buildActiveThreadPollLoadOptions,
    conversationsLoadingRef,
    hasPendingInitialAnchorForConversation,
    hasPersistedThreadMessageEquivalent,
    lastConversationsLoadAtRef,
    latestActiveThreadSocketMessageRef,
    loadConversations,
    loadMessages,
    loadMessagesRef,
    logChatDebug,
    logChatDebugRef,
    markConversationReadLiveRef,
    markSocketActivity,
    mergeAiStatusPayload,
    mergeMessageIntoThread,
    messagesLoadingRef,
    messagesRef,
    onConversationRemoved,
    promoteConversationToTop,
    queueAutoScroll,
    setAiStatusByConversation,
    setMessages,
    setSocketStatus,
    setTypingUsers,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
    shouldSkipActiveThreadRevalidate,
    skippedInitialSnapshotRefreshRef,
    skippedInitialSocketRefreshRef,
    socketStatusRef,
    syncConversationPreview,
    threadNearBottomRef,
    typingParticipantsTimeoutsRef,
    updatePresenceInCollections,
    upsertConversation,
    userId,
  });
}

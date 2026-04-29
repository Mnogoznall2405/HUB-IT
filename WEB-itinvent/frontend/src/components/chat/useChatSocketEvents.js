import { startTransition, useEffect } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import {
  CHAT_SOCKET_ACTIVITY_EVENT,
  CHAT_SOCKET_AI_RUN_UPDATED_EVENT,
  CHAT_SOCKET_CONVERSATION_UPDATED_EVENT,
  CHAT_SOCKET_MESSAGE_CREATED_EVENT,
  CHAT_SOCKET_MESSAGE_READ_EVENT,
  CHAT_SOCKET_PRESENCE_UPDATED_EVENT,
  CHAT_SOCKET_SNAPSHOT_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
  CHAT_SOCKET_TYPING_EVENT,
} from '../../lib/chatSocket';

export default function useChatSocketEvents({
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
  markSocketActivity,
  mergeAiStatusPayload,
  mergeMessageIntoThread,
  messagesLoadingRef,
  messagesRef,
  promoteConversationToTop,
  queueAutoScroll,
  setAiStatusByConversation,
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
  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    const handleSocketActivity = (event) => {
      const eventType = String(event?.detail?.type || '').trim() || 'socket:message';
      markSocketActivity(eventType);
    };

    const handleSocketStatus = (event) => {
      const nextStatus = String(event?.detail?.status || '').trim() || 'disconnected';
      const previousStatus = socketStatusRef.current;
      logChatDebug('socket:status', {
        previousStatus,
        nextStatus,
      });
      if (nextStatus === previousStatus) return;
      socketStatusRef.current = nextStatus;
      setSocketStatus(nextStatus);
      if (nextStatus === 'connected' && previousStatus !== 'connected') {
        markSocketActivity('socket:connected');
        if (!skippedInitialSocketRefreshRef.current) {
          skippedInitialSocketRefreshRef.current = true;
          return;
        }
        if ((Date.now() - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
        if (conversationsLoadingRef.current) return;
        void loadConversations({ silent: true, force: true });
        if (
          activeConversationIdRef.current
          && !messagesLoadingRef.current
          && !hasPendingInitialAnchorForConversation(activeConversationIdRef.current)
        ) {
          void loadMessages(activeConversationIdRef.current, { silent: true, reason: 'socket:connected', force: true });
        }
      }
    };

    const handleSnapshot = () => {
      markSocketActivity('chat.snapshot');
      if (!skippedInitialSnapshotRefreshRef.current) {
        skippedInitialSnapshotRefreshRef.current = true;
        return;
      }
      if ((Date.now() - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
      if (conversationsLoadingRef.current) return;
      void loadConversations({ silent: true, force: true });
    };

    const handleConversationUpdated = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversation = payload?.conversation;
      const reason = String(payload?.reason || '').trim();
      if (!conversation?.id) return;
      upsertConversation(conversation, {
        promote: reason === 'message_created' || reason === 'created',
      });
      const normalizedConversationId = String(conversation?.id || '').trim();
      if (
        normalizedConversationId
        && normalizedConversationId === activeConversationIdRef.current
        && !messagesLoadingRef.current
        && (
          reason === 'message_created'
          || reason === 'created'
          || reason === 'updated'
        )
      ) {
        if (shouldSkipActiveThreadRevalidate({
          activeConversationId: activeConversationIdRef.current,
          conversationId: normalizedConversationId,
          reason,
          messages: messagesRef.current,
          latestSocketMessage: latestActiveThreadSocketMessageRef.current,
        })) {
          logChatDebug('threadRevalidate:skipped', {
            conversationId: normalizedConversationId,
            reason: `socket:conversation_updated:${reason || 'unknown'}`,
          });
          return;
        }
        const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
        void loadMessagesRef.current?.(normalizedConversationId, {
          ...requestOptions,
          reason: reason === 'updated'
            ? 'socket:conversation_updated'
            : (requestOptions.afterMessageId ? 'socket:conversation_updated:newer' : 'socket:conversation_updated:bootstrap'),
        });
      }
    };

    const handleMessageCreated = (event) => {
      const envelope = event?.detail || {};
      const message = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
      if (!message?.id || conversationId !== activeConversationIdRef.current) return;
      const alreadyRendered = hasPersistedThreadMessageEquivalent(messagesRef.current, message);
      latestActiveThreadSocketMessageRef.current = {
        conversationId,
        messageId: String(message.id || '').trim(),
        at: Date.now(),
      };
      if (String(activeConversation?.kind || '').trim() === 'ai' && !Boolean(message?.is_own)) {
        const startedAt = Number(aiRunStartedAtByConversationRef.current?.[conversationId] || 0);
        if (Number.isFinite(startedAt) && startedAt > 0) {
          logChatDebugRef.current?.('aiRun:replyLatency', {
            conversationId,
            messageId: String(message?.id || '').trim(),
            latencyMs: Math.max(0, Date.now() - startedAt),
          });
          aiRunStartedAtByConversationRef.current = {
            ...aiRunStartedAtByConversationRef.current,
            [conversationId]: 0,
          };
        }
      }
      if (!alreadyRendered) {
        mergeMessageIntoThread(message);
        startTransition(() => {
          syncConversationPreview(conversationId, message, message?.is_own ? { unread_count: 0 } : {});
          promoteConversationToTop(conversationId);
        });
      }
      if (message?.is_own) {
        setViewerLastReadMessageId(String(message.id || '').trim());
        setViewerLastReadAt(String(message.created_at || '').trim());
      }
      if (!hasPendingInitialAnchorForConversation(conversationId)) {
        const nextScrollMode = !alreadyRendered && (Boolean(message?.is_own) || threadNearBottomRef.current)
          ? 'bottom_instant'
          : false;
        queueAutoScroll(nextScrollMode, 'socket:message_created');
      }
    };

    const handleMessageRead = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const message = payload?.message;
      const conversationId = String(
        envelope?.conversation_id
        || payload?.conversation_id
        || message?.conversation_id
        || ''
      ).trim();
      if (conversationId !== activeConversationIdRef.current) return;
      if (message?.id) {
        mergeMessageIntoThread(message);
        return;
      }
      if (!String(payload?.message_id || '').trim()) return;
      applyMessageReadDelta(payload);
    };

    const handlePresenceUpdated = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      updatePresenceInCollections(payload?.user_id, payload?.presence);
    };

    const handleTyping = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || '').trim();
      const typingUserId = Number(payload?.user_id || 0);
      const senderName = String(payload?.sender_name || '').trim();
      if (!conversationId || conversationId !== activeConversationIdRef.current || !typingUserId || typingUserId === Number(userId || 0)) {
        return;
      }
      const isTyping = String(envelope?.type || '').trim() === 'chat.typing.started';
      const key = `${conversationId}:${typingUserId}`;
      const currentTimeout = typingParticipantsTimeoutsRef.current.get(key);
      if (currentTimeout) {
        window.clearTimeout(currentTimeout);
        typingParticipantsTimeoutsRef.current.delete(key);
      }
      if (isTyping) {
        setTypingUsers((current) => (
          current.includes(senderName) ? current : [...current, senderName].filter(Boolean)
        ));
        const timeoutId = window.setTimeout(() => {
          setTypingUsers((current) => current.filter((item) => item !== senderName));
          typingParticipantsTimeoutsRef.current.delete(key);
        }, 4000);
        typingParticipantsTimeoutsRef.current.set(key, timeoutId);
        return;
      }
      setTypingUsers((current) => current.filter((item) => item !== senderName));
    };

    const handleAiRunUpdated = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversationId = String(
        envelope?.conversation_id
        || payload?.conversation_id
        || ''
      ).trim();
      if (!conversationId) return;
      const status = String(payload?.status || '').trim();
      const botTitle = String(payload?.bot_title || '').trim();
      setAiStatusByConversation((current) => mergeAiStatusPayload(current, payload, conversationId));
      if ((status === 'queued' || status === 'running') && String(payload?.run_id || '').trim()) {
        setTypingUsers((current) => (
          botTitle && !current.includes(botTitle) ? [...current, botTitle] : current
        ));
        aiRunStartedAtByConversationRef.current = {
          ...aiRunStartedAtByConversationRef.current,
          [conversationId]: Date.parse(String(payload?.updated_at || '').trim()) || Date.now(),
        };
      }
      if (
        conversationId === activeConversationIdRef.current
        && (status === 'completed' || status === 'failed')
        && !messagesLoadingRef.current
      ) {
        const skipThreadRevalidate = shouldSkipActiveThreadRevalidate({
          activeConversationId: activeConversationIdRef.current,
          conversationId,
          reason: status === 'completed' ? 'ai_run_completed' : 'ai_run_failed',
          messages: messagesRef.current,
          latestSocketMessage: latestActiveThreadSocketMessageRef.current,
        });
        if (skipThreadRevalidate) {
          logChatDebug('threadRevalidate:skipped', {
            conversationId,
            reason: `socket:ai-run-updated:${status}`,
          });
        } else {
          const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
          void loadMessagesRef.current?.(conversationId, {
            ...requestOptions,
            reason: requestOptions.afterMessageId ? 'socket:ai-run-updated:newer' : 'socket:ai-run-updated:bootstrap',
          });
        }
      }
      if ((status === 'completed' || status === 'failed') && botTitle) {
        setTypingUsers((current) => current.filter((item) => item !== botTitle));
        aiRunStartedAtByConversationRef.current = {
          ...aiRunStartedAtByConversationRef.current,
          [conversationId]: 0,
        };
      }
    };

    window.addEventListener(CHAT_SOCKET_ACTIVITY_EVENT, handleSocketActivity);
    window.addEventListener(CHAT_SOCKET_STATUS_EVENT, handleSocketStatus);
    window.addEventListener(CHAT_SOCKET_SNAPSHOT_EVENT, handleSnapshot);
    window.addEventListener(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, handleConversationUpdated);
    window.addEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleMessageCreated);
    window.addEventListener(CHAT_SOCKET_MESSAGE_READ_EVENT, handleMessageRead);
    window.addEventListener(CHAT_SOCKET_PRESENCE_UPDATED_EVENT, handlePresenceUpdated);
    window.addEventListener(CHAT_SOCKET_TYPING_EVENT, handleTyping);
    window.addEventListener(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, handleAiRunUpdated);

    return () => {
      window.removeEventListener(CHAT_SOCKET_ACTIVITY_EVENT, handleSocketActivity);
      window.removeEventListener(CHAT_SOCKET_STATUS_EVENT, handleSocketStatus);
      window.removeEventListener(CHAT_SOCKET_SNAPSHOT_EVENT, handleSnapshot);
      window.removeEventListener(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, handleConversationUpdated);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleMessageCreated);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_READ_EVENT, handleMessageRead);
      window.removeEventListener(CHAT_SOCKET_PRESENCE_UPDATED_EVENT, handlePresenceUpdated);
      window.removeEventListener(CHAT_SOCKET_TYPING_EVENT, handleTyping);
      window.removeEventListener(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, handleAiRunUpdated);
    };
  }, [
    activeConversation?.kind,
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
    markSocketActivity,
    mergeAiStatusPayload,
    mergeMessageIntoThread,
    messagesLoadingRef,
    messagesRef,
    promoteConversationToTop,
    queueAutoScroll,
    setAiStatusByConversation,
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
  ]);
}

import { startTransition, useEffect, useRef } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { emitAgentDebugLog } from '../../lib/debugClientLog';
import {
  chatSocket,
  CHAT_SOCKET_ACTIVITY_EVENT,
  CHAT_SOCKET_AI_RUN_UPDATED_EVENT,
  CHAT_SOCKET_CONVERSATION_REMOVED_EVENT,
  CHAT_SOCKET_CONVERSATION_UPDATED_EVENT,
  CHAT_SOCKET_MESSAGE_CREATED_EVENT,
  CHAT_SOCKET_MESSAGE_DELETED_EVENT,
  CHAT_SOCKET_MESSAGE_UPDATED_EVENT,
  CHAT_SOCKET_MESSAGE_REACTION_EVENT,
  CHAT_SOCKET_MESSAGE_READ_EVENT,
  CHAT_SOCKET_PRESENCE_UPDATED_EVENT,
  CHAT_SOCKET_SNAPSHOT_EVENT,
  CHAT_SOCKET_STATUS_EVENT,
  CHAT_SOCKET_TYPING_EVENT,
  CHAT_SOCKET_UNREAD_SUMMARY_EVENT,
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
  loadChatFolders,
  loadConversations,
  loadMessages,
  loadMessagesRef,
  logChatDebug,
  logChatDebugRef,
  markConversationReadLiveRef,
  markSocketActivity,
  mergeAiStatusPayload,
  mergeMessageIntoThread,
  messagesHasNewerRef,
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
  const readSeqByConversationRef = useRef(new Map());

  const initialSocketStatusReplayedRef = useRef(false);

  useEffect(() => {
    if (!CHAT_FEATURE_ENABLED || !CHAT_WS_ENABLED) return undefined;
    // The bootstrap socket can already be connected before this page mounts —
    // its status event fired before we subscribed. Replay the live state so
    // the header does not sit on a stale "connecting" (R1). Anything other
    // than a fresh first connect means the initial connect already happened,
    // so the next "connected" is a real reconnect that must refresh data.
    // One-shot: this effect re-runs whenever a dep identity changes; replaying
    // the live state again would clobber a later real transition.
    if (!initialSocketStatusReplayedRef.current) {
      initialSocketStatusReplayedRef.current = true;
      const currentSocketStatus = chatSocket.getConnectionState();
      if (currentSocketStatus !== 'connecting') {
        skippedInitialSocketRefreshRef.current = true;
      }
      if (currentSocketStatus === 'connected') {
        markSocketActivity('socket:init:connected');
      }
      if (currentSocketStatus !== socketStatusRef.current) {
        socketStatusRef.current = currentSocketStatus;
        setSocketStatus(currentSocketStatus);
      }
    }
    // Room + inbox can both deliver the same message.created; apply sidebar preview once.
    const previewAppliedByConversation = new Map();
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
        // The active thread always catches up on reconnect — the conversations
        // list throttle below must not skip it (P1-6).
        if (
          activeConversationIdRef.current
          && !hasPendingInitialAnchorForConversation(activeConversationIdRef.current)
        ) {
          const requestOptions = buildActiveThreadPollLoadOptions(messagesRef.current);
          void Promise.resolve(loadMessages(activeConversationIdRef.current, {
            ...requestOptions,
            reason: requestOptions.afterMessageId ? 'socket:connected:newer' : 'socket:connected:bootstrap',
          })).catch(() => {});
        }
        if ((Date.now() - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
        if (conversationsLoadingRef.current) return;
        void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
      }
    };

    // U2: unread-driven events refresh the server folder_unread_counts payload —
    // debounced so an unread.summary burst does not storm /chat/folders.
    let folderCountsRefreshTimer = null;
    const scheduleFolderCountsRefresh = () => {
      if (typeof loadChatFolders !== 'function') return;
      if (folderCountsRefreshTimer) window.clearTimeout(folderCountsRefreshTimer);
      folderCountsRefreshTimer = window.setTimeout(() => {
        folderCountsRefreshTimer = null;
        void Promise.resolve(loadChatFolders({ silent: true })).catch(() => {});
      }, 800);
    };
    const handleUnreadSummary = () => {
      scheduleFolderCountsRefresh();
    };

    const handleSnapshot = () => {
      markSocketActivity('chat.snapshot');
      if (!skippedInitialSnapshotRefreshRef.current) {
        skippedInitialSnapshotRefreshRef.current = true;
        return;
      }
      if ((Date.now() - Number(lastConversationsLoadAtRef.current || 0)) < 3000) return;
      if (conversationsLoadingRef.current) return;
      void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
    };

    const handleConversationUpdated = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversation = payload?.conversation;
      const reason = String(payload?.reason || '').trim();
      if (!conversation?.id) return;
      const normalizedConversationId = String(conversation?.id || '').trim();
      const incomingReadSeq = Math.max(0, Number(conversation?.viewer_last_read_seq || 0));
      const rememberedReadSeq = Math.max(
        0,
        Number(readSeqByConversationRef.current.get(normalizedConversationId) || 0),
      );
      const effectiveReadSeq = Math.max(incomingReadSeq, rememberedReadSeq);
      if (effectiveReadSeq > 0) {
        readSeqByConversationRef.current.set(normalizedConversationId, effectiveReadSeq);
      }
      const lastMessageSeq = Math.max(0, Number(conversation?.last_message_seq || 0));
      const isActiveAndAtBottom = (
        normalizedConversationId
        && normalizedConversationId === activeConversationIdRef.current
        && threadNearBottomRef.current
      );
      const isReadThroughLatest = lastMessageSeq > 0 && effectiveReadSeq >= lastMessageSeq;
      const nextConversation = (isActiveAndAtBottom || isReadThroughLatest)
        ? {
          ...conversation,
          viewer_last_read_seq: effectiveReadSeq,
          unread_count: 0,
        }
        : conversation;
      upsertConversation(
        nextConversation,
        { promote: reason === 'message_created' || reason === 'created' },
      );
      // U2: unread-bearing conversation updates refresh server folder counts.
      scheduleFolderCountsRefresh();
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
      const rawMessage = envelope?.payload || {};
      // Room broadcast may send a shared payload (is_own=false); resolve against current user.
      const senderId = Number(
        rawMessage?.sender?.id
        || rawMessage?.sender_user_id
        || rawMessage?.sender?.user_id
        || 0,
      );
      const currentUserId = Number(userId || 0);
      const resolvedIsOwn = currentUserId > 0 && senderId > 0
        ? senderId === currentUserId
        : Boolean(rawMessage?.is_own);
      const message = rawMessage?.is_own === resolvedIsOwn
        ? rawMessage
        : {
          ...rawMessage,
          is_own: resolvedIsOwn,
          delivery_status: resolvedIsOwn
            ? (rawMessage?.delivery_status || 'sent')
            : null,
          read_by_count: resolvedIsOwn ? Number(rawMessage?.read_by_count || 0) : 0,
        };
      const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
      const activeId = String(activeConversationIdRef.current || '').trim();
      // #region agent log
      emitAgentDebugLog({
        location: 'useChatSocketEvents.js:handleMessageCreated:is_own',
        message: 'resolved message.created is_own',
        hypothesisId: 'J',
        data: {
          conversationId,
          activeId,
          messageId: String(rawMessage?.id || '').trim(),
          senderId,
          currentUserId,
          rawIsOwn: Boolean(rawMessage?.is_own),
          resolvedIsOwn,
          flipped: Boolean(rawMessage?.is_own) !== Boolean(resolvedIsOwn),
        },
      });
      // #endregion
      if (!message?.id || !conversationId) {
        // #region agent log
        emitAgentDebugLog({
          location: 'useChatSocketEvents.js:handleMessageCreated',
          message: 'message.created dropped: missing id/conversation',
          hypothesisId: 'H3',
          data: {
            hasMessageId: Boolean(message?.id),
            conversationId,
            activeId,
            payloadConversationId: String(message?.conversation_id || '').trim(),
          },
        });
        // #endregion
        return;
      }

      if (conversationId !== activeConversationIdRef.current) {
        const previewMessageId = String(message.id || '').trim();
        if (previewAppliedByConversation.get(conversationId) === previewMessageId) {
          return;
        }
        previewAppliedByConversation.set(conversationId, previewMessageId);
        // #region agent log
        emitAgentDebugLog({
          location: 'useChatSocketEvents.js:handleMessageCreated',
          message: 'message.created for non-active conversation (preview only)',
          hypothesisId: 'I2',
          data: {
            conversationId,
            activeId,
            messageId: previewMessageId,
            isOwn: Boolean(resolvedIsOwn),
            senderId,
            currentUserId,
          },
        });
        // #endregion
        startTransition(() => {
          // Targeted sidebar patch only — do not reload the whole conversations list.
          const matched = syncConversationPreview(
            conversationId,
            message,
            resolvedIsOwn ? { unread_count: 0 } : {},
          );
          promoteConversationToTop(conversationId);
          // Conversation missing from sidebar (filtered/stale page) — force list refresh.
          if (!matched) {
            // #region agent log
            emitAgentDebugLog({
              location: 'useChatSocketEvents.js:handleMessageCreated',
              message: 'preview patch missed conversation → force list reload',
              hypothesisId: 'P1',
              runId: 'chat-preview',
              data: { conversationId, messageId: previewMessageId },
            });
            // #endregion
            void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
          }
        });
        return;
      }

      const isActive = conversationId === activeConversationIdRef.current;
      const alreadyRendered = hasPersistedThreadMessageEquivalent(messagesRef.current, message);
      const messageSeq = Math.max(0, Number(message?.conversation_seq || 0));
      const tabIsVisibleAndFocused = (
        typeof document !== 'undefined'
        && document.visibilityState === 'visible'
        && typeof document.hasFocus === 'function'
        && document.hasFocus()
      );
      const shouldTreatAsRead = resolvedIsOwn || (isActive && tabIsVisibleAndFocused && threadNearBottomRef.current === true);
      // #region agent log
      emitAgentDebugLog({
        location: 'useChatSocketEvents.js:handleMessageCreated',
        message: alreadyRendered ? 'active message already rendered' : 'merging active message into thread',
        hypothesisId: 'H3',
        data: {
          conversationId,
          activeId,
          messageId: String(message.id || '').trim(),
          alreadyRendered,
          nearBottom: Boolean(threadNearBottomRef.current),
          messageConversationId: String(message?.conversation_id || '').trim(),
          threadLen: Array.isArray(messagesRef.current) ? messagesRef.current.length : -1,
        },
      });
      // #endregion
      latestActiveThreadSocketMessageRef.current = {
        conversationId,
        messageId: String(message.id || '').trim(),
        at: Date.now(),
      };
      if (String(activeConversation?.kind || '').trim() === 'ai' && !resolvedIsOwn) {
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
      // R27: while the loaded window is cut off from the tail (has_newer) a
      // socket message must NOT be appended — the drain cursor is the last
      // message of the contiguous window, so inserting it would leave a hole
      // that no page can ever fill. Only bump the ↓ badge (unread_count) and
      // update the sidebar preview; pages deliver the message contiguously.
      const windowCutFromTail = Boolean(messagesHasNewerRef?.current);
      if (!alreadyRendered && !windowCutFromTail) {
        mergeMessageIntoThread(message, { liveAppear: true });
        startTransition(() => {
          syncConversationPreview(conversationId, message, shouldTreatAsRead ? {
            unread_count: 0,
            ...(messageSeq > 0 ? {
              last_message_seq: messageSeq,
              viewer_last_read_seq: messageSeq,
            } : {}),
          } : {});
          promoteConversationToTop(conversationId);
          if (!resolvedIsOwn && senderId > 0 && typeof updatePresenceInCollections === 'function') {
            updatePresenceInCollections(senderId, {
              is_online: true,
              last_seen_at: String(message?.created_at || '').trim() || null,
              status_text: 'В сети',
            });
          }
        });
      } else if (!alreadyRendered && windowCutFromTail) {
        const skippedMessageId = String(message.id || '').trim();
        if (previewAppliedByConversation.get(conversationId) !== skippedMessageId) {
          previewAppliedByConversation.set(conversationId, skippedMessageId);
          startTransition(() => {
            syncConversationPreview(conversationId, message);
            promoteConversationToTop(conversationId);
          });
        }
      }
      if (resolvedIsOwn) {
        if (messageSeq > 0) {
          readSeqByConversationRef.current.set(conversationId, Math.max(
            messageSeq,
            Number(readSeqByConversationRef.current.get(conversationId) || 0),
          ));
        }
        setViewerLastReadMessageId(String(message.id || '').trim());
        setViewerLastReadAt(String(message.created_at || '').trim());
      } else if (isActive) {
        // A message below the unloaded tail was never on screen — it must not
        // be marked read while the window is cut (only read what was viewed).
        if (tabIsVisibleAndFocused && threadNearBottomRef.current === true && !windowCutFromTail) {
          if (messageSeq > 0) {
            readSeqByConversationRef.current.set(conversationId, Math.max(
              messageSeq,
              Number(readSeqByConversationRef.current.get(conversationId) || 0),
            ));
          }
          setViewerLastReadMessageId(String(message.id || '').trim());
          setViewerLastReadAt(String(message.created_at || '').trim());
          void markConversationReadLiveRef?.current?.(conversationId, String(message.id || '').trim());
        }
      }
      if (alreadyRendered && messageSeq > 0 && (
        resolvedIsOwn
        || Number(readSeqByConversationRef.current.get(conversationId) || 0) >= messageSeq
      )) {
        startTransition(() => {
          syncConversationPreview(conversationId, message, {
            unread_count: 0,
            last_message_seq: messageSeq,
            viewer_last_read_seq: Number(readSeqByConversationRef.current.get(conversationId) || messageSeq),
          });
          promoteConversationToTop(conversationId);
        });
      }
      if (!hasPendingInitialAnchorForConversation(conversationId)) {
        // Own messages always stick to the bottom. Incoming messages only
        // pull the viewport down when the reader is already near the bottom,
        // so reading older history is never interrupted by a forced jump.
        const shouldStickToBottom = !alreadyRendered && !windowCutFromTail && (
          resolvedIsOwn
          || (isActive && threadNearBottomRef.current)
        );
        queueAutoScroll(shouldStickToBottom ? 'bottom_instant' : false, 'socket:message_created');
      }
    };

    const handleMessageDeleted = (event) => {
      const envelope = event?.detail || {};
      const message = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
      if (!message?.id || conversationId !== activeConversationIdRef.current) return;
      mergeMessageIntoThread(message);
      syncConversationPreview(conversationId, message);
    };

    const handleMessageUpdated = (event) => {
      const envelope = event?.detail || {};
      const message = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
      if (!message?.id || conversationId !== activeConversationIdRef.current) return;
      latestActiveThreadSocketMessageRef.current = {
        conversationId,
        messageId: String(message.id || '').trim(),
        at: Date.now(),
      };
      mergeMessageIntoThread(message);
      syncConversationPreview(conversationId, message);
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
      if ((status === 'completed' || status === 'failed' || status === 'cancelled') && botTitle) {
        setTypingUsers((current) => current.filter((item) => item !== botTitle));
        aiRunStartedAtByConversationRef.current = {
          ...aiRunStartedAtByConversationRef.current,
          [conversationId]: 0,
        };
      }
    };

    const handleConversationRemoved = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || payload?.conversation_id || '').trim();
      if (!conversationId) return;
      readSeqByConversationRef.current.delete(conversationId);
      if (typeof onConversationRemoved === 'function') {
        onConversationRemoved(conversationId);
      }
      void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
    };

    const handleMessageReaction = (event) => {
      const envelope = event?.detail || {};
      const payload = envelope?.payload || {};
      const conversationId = String(envelope?.conversation_id || payload?.conversation_id || '').trim();
      if (conversationId !== activeConversationIdRef.current) return;
      const messageId = String(payload?.message_id || '').trim();
      const reactions = payload?.reactions;
      if (!messageId || !Array.isArray(reactions)) return;
      startTransition(() => {
        setMessages?.((current) => current.map((msg) => (
          String(msg?.id || '') === messageId ? { ...msg, reactions } : msg
        )));
      });
    };

    window.addEventListener(CHAT_SOCKET_ACTIVITY_EVENT, handleSocketActivity);
    window.addEventListener(CHAT_SOCKET_STATUS_EVENT, handleSocketStatus);
    window.addEventListener(CHAT_SOCKET_SNAPSHOT_EVENT, handleSnapshot);
    window.addEventListener(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, handleConversationUpdated);
    window.addEventListener(CHAT_SOCKET_CONVERSATION_REMOVED_EVENT, handleConversationRemoved);
    window.addEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleMessageCreated);
    window.addEventListener(CHAT_SOCKET_MESSAGE_DELETED_EVENT, handleMessageDeleted);
    window.addEventListener(CHAT_SOCKET_MESSAGE_UPDATED_EVENT, handleMessageUpdated);
    window.addEventListener(CHAT_SOCKET_MESSAGE_READ_EVENT, handleMessageRead);
    window.addEventListener(CHAT_SOCKET_MESSAGE_REACTION_EVENT, handleMessageReaction);
    window.addEventListener(CHAT_SOCKET_PRESENCE_UPDATED_EVENT, handlePresenceUpdated);
    window.addEventListener(CHAT_SOCKET_TYPING_EVENT, handleTyping);
    window.addEventListener(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, handleAiRunUpdated);
    window.addEventListener(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, handleUnreadSummary);

    return () => {
      window.removeEventListener(CHAT_SOCKET_ACTIVITY_EVENT, handleSocketActivity);
      window.removeEventListener(CHAT_SOCKET_STATUS_EVENT, handleSocketStatus);
      window.removeEventListener(CHAT_SOCKET_SNAPSHOT_EVENT, handleSnapshot);
      window.removeEventListener(CHAT_SOCKET_CONVERSATION_UPDATED_EVENT, handleConversationUpdated);
      window.removeEventListener(CHAT_SOCKET_CONVERSATION_REMOVED_EVENT, handleConversationRemoved);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_CREATED_EVENT, handleMessageCreated);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_DELETED_EVENT, handleMessageDeleted);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_UPDATED_EVENT, handleMessageUpdated);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_READ_EVENT, handleMessageRead);
      window.removeEventListener(CHAT_SOCKET_MESSAGE_REACTION_EVENT, handleMessageReaction);
      window.removeEventListener(CHAT_SOCKET_PRESENCE_UPDATED_EVENT, handlePresenceUpdated);
      window.removeEventListener(CHAT_SOCKET_TYPING_EVENT, handleTyping);
      window.removeEventListener(CHAT_SOCKET_AI_RUN_UPDATED_EVENT, handleAiRunUpdated);
      window.removeEventListener(CHAT_SOCKET_UNREAD_SUMMARY_EVENT, handleUnreadSummary);
      if (folderCountsRefreshTimer) {
        window.clearTimeout(folderCountsRefreshTimer);
        folderCountsRefreshTimer = null;
      }
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
    loadChatFolders,
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
  ]);
}

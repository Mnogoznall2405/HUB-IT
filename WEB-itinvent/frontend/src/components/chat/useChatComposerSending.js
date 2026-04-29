import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import { CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';
import {
  buildChatDraftKey,
  detectChatBodyFormat,
} from './chatHelpers';

export default function useChatComposerSending({
  activeConversation,
  activeConversationId,
  activeConversationIdRef,
  applyOutgoingThreadMessage,
  buildReplyPreview,
  cancelPendingInitialAnchor,
  createOptimisticTextMessage,
  draftWriteTimeoutRef,
  flushDraftToStorage,
  focusComposer,
  latestMessageTextRef,
  logChatDebug,
  messageText,
  notifyApiError,
  readSelectedDatabaseId,
  removeThreadMessage,
  replyMessage,
  setMessageText,
  setOptimisticAiQueuedStatus,
  setReplyMessage,
  setSocketStatus,
  socketStatusRef,
  userId,
}) {
  const sendMessage = useCallback(async () => {
    const conversationId = String(activeConversationId || '').trim();
    const body = String(messageText || '').trim();
    if (!conversationId || !body) return false;
    const bodyFormat = detectChatBodyFormat(body);
    const draftReplyMessage = replyMessage ? { ...replyMessage } : null;
    const optimisticMessage = createOptimisticTextMessage({
      conversationId,
      body,
      bodyFormat,
      replyPreview: buildReplyPreview(draftReplyMessage),
    });
    const draftStorageKeyForConversation = buildChatDraftKey(userId, conversationId);
    if (draftWriteTimeoutRef.current) {
      window.clearTimeout(draftWriteTimeoutRef.current);
      draftWriteTimeoutRef.current = null;
    }
    flushDraftToStorage(draftStorageKeyForConversation, '');
    setMessageText('');
    setReplyMessage(null);
    if (optimisticMessage) {
      applyOutgoingThreadMessage(conversationId, optimisticMessage, {
        scroll: true,
        scrollSource: 'sendMessage',
      });
    }
    cancelPendingInitialAnchor();
    logChatDebug('sendMessage:autoScroll', {
      conversationId,
      optimistic: Boolean(optimisticMessage),
    });
    focusComposer({ forceMobile: true });
    try {
      let serverMessage = null;
      const canSendViaSocket = CHAT_WS_ENABLED && socketStatusRef.current === 'connected';
      if (canSendViaSocket) {
        try {
          const response = await chatSocket.sendMessage(conversationId, body, {
            client_message_id: optimisticMessage?.client_message_id || undefined,
            database_id: readSelectedDatabaseId() || undefined,
            reply_to_message_id: draftReplyMessage?.id || undefined,
            body_format: bodyFormat,
          });
          serverMessage = response?.message || null;
        } catch (socketError) {
          logChatDebug('sendMessage:socketFallback', {
            conversationId,
            error: String(socketError?.message || socketError),
          });
          socketStatusRef.current = 'disconnected';
          setSocketStatus('disconnected');
        }
      }
      if (!serverMessage) {
        serverMessage = await chatAPI.sendMessage(conversationId, body, {
          client_message_id: optimisticMessage?.client_message_id || undefined,
          reply_to_message_id: draftReplyMessage?.id || undefined,
          body_format: bodyFormat,
        });
      }
      if (serverMessage?.id) {
        applyOutgoingThreadMessage(conversationId, serverMessage, {
          replaceId: optimisticMessage?.id,
          scroll: false,
          scrollSource: 'sendMessage:server',
        });
        if (activeConversation?.kind === 'ai') {
          setOptimisticAiQueuedStatus(conversationId, activeConversation?.title);
        }
      } else if (optimisticMessage?.id) {
        removeThreadMessage(optimisticMessage.id);
      }
      return true;
    } catch (error) {
      if (optimisticMessage?.id) {
        removeThreadMessage(optimisticMessage.id);
      }
      const currentDraftText = String(latestMessageTextRef.current || '').trim();
      if (activeConversationIdRef.current === conversationId && !currentDraftText) {
        setMessageText((current) => (String(current || '').trim() ? current : body));
        setReplyMessage((current) => current ?? draftReplyMessage);
        focusComposer({ forceMobile: true });
      } else if (draftStorageKeyForConversation) {
        try {
          window.localStorage.setItem(draftStorageKeyForConversation, body);
        } catch {
          // Ignore browser storage failures for drafts.
        }
      }
      notifyApiError(error, 'Не удалось отправить сообщение.');
      return false;
    }
  }, [
    activeConversation?.kind,
    activeConversation?.title,
    activeConversationId,
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticTextMessage,
    draftWriteTimeoutRef,
    flushDraftToStorage,
    focusComposer,
    latestMessageTextRef,
    logChatDebug,
    messageText,
    notifyApiError,
    readSelectedDatabaseId,
    removeThreadMessage,
    replyMessage,
    setMessageText,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    setSocketStatus,
    socketStatusRef,
    userId,
  ]);

  const handleComposerSend = useCallback(async () => sendMessage(), [sendMessage]);

  return {
    handleComposerSend,
    sendMessage,
  };
}

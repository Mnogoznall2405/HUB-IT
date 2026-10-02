import { useCallback, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { chatStickersAPI } from '../../api/chatStickers';
import { CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { chatSocket } from '../../lib/chatSocket';
import { resolveServerMessageFromSendAck } from '../../lib/chat/chatSendAck';
import { buildChatDraftKey, CHAT_MESSAGE_BODY_MAX_LENGTH } from './chatHelpers';

export default function useChatComposerSending({
  activeConversation,
  activeConversationId,
  activeConversationIdRef,
  applyOutgoingThreadMessage,
  ensureLatestThreadWindow,
  buildReplyPreview,
  cancelPendingInitialAnchor,
  createOptimisticTextMessage,
  draftWriteTimeoutRef,
  editingMessage,
  failedThreadMessagesRef,
  flushDraftToStorage,
  focusComposer,
  latestMessageTextRef,
  logChatDebug,
  mergeMessageIntoThread,
  notifyApiError,
  readSelectedDatabaseId,
  removeThreadMessage,
  replyMessage,
  setEditingMessage,
  setMessageText,
  setOptimisticAiQueuedStatus,
  setReplyMessage,
  socketStatusRef,
  userId,
}) {
  // Failed outgoing bubbles keyed by conversation so they survive thread
  // switches and list refreshes (in-memory only; a reload clears them).
  // R4: the map is a page-level ref — the thread controller merges these
  // records back after every thread payload.
  const internalFailedMessagesRef = useRef(new Map());
  const failedMessagesRef = failedThreadMessagesRef || internalFailedMessagesRef;

  const markOptimisticMessageFailed = useCallback((conversationId, optimisticMessage, replyToMessageId, extras = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    const messageId = String(optimisticMessage?.id || '').trim();
    if (!normalizedConversationId || !messageId) return;
    // U3: the appear flag is consumed by the failed state — a restored bubble
    // after a conversation switch must mount without the live animation.
    const failedMessage = { ...optimisticMessage, optimisticStatus: 'failed', animateAppear: false };
    let byConversation = failedMessagesRef.current.get(normalizedConversationId);
    if (!byConversation) {
      byConversation = new Map();
      failedMessagesRef.current.set(normalizedConversationId, byConversation);
    }
    byConversation.set(messageId, {
      conversationId: normalizedConversationId,
      clientMessageId: String(optimisticMessage?.client_message_id || '').trim(),
      body: String(optimisticMessage?.body || ''),
      bodyFormat: String(optimisticMessage?.body_format || 'plain').trim() || 'plain',
      replyToMessageId: String(replyToMessageId || optimisticMessage?.reply_preview?.id || '').trim(),
      message: failedMessage,
      fileResend: extras.fileResend || null,
      stickerResend: extras.stickerResend || null,
    });
    applyOutgoingThreadMessage(normalizedConversationId, failedMessage, {
      scroll: false,
      scrollSource: 'sendMessage:failed',
    });
  }, [applyOutgoingThreadMessage]);

  // File uploads use the same failed-bubble registry so an unsent album keeps
  // its ⚠ state across refreshes; retryFailedMessage replays the upload.
  const registerFailedOutgoingMessage = useCallback((conversationId, optimisticMessage, extras = {}) => {
    markOptimisticMessageFailed(conversationId, optimisticMessage, extras?.replyToMessageId, extras);
  }, [markOptimisticMessageFailed]);

  const discardFailedMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return false;
    for (const byConversation of failedMessagesRef.current.values()) {
      if (!byConversation.has(normalizedMessageId)) continue;
      byConversation.delete(normalizedMessageId);
      removeThreadMessage(normalizedMessageId);
      return true;
    }
    return false;
  }, [removeThreadMessage]);

  // WS first, HTTP with the same client_message_id as fallback (idempotent on
  // the server). R3: only explicit rejections — validation_error / forbidden —
  // skip the fallback; transient server answers (command_failed, rate_limited)
  // and dead transports fall back to HTTP.
  const deliverOptimisticMessage = useCallback(async (conversationId, optimisticMessage, body, bodyFormat, replyToMessageId) => {
    let serverMessage = null;
    const canSendViaSocket = CHAT_WS_ENABLED
      && chatSocket.isOpen()
      && socketStatusRef.current === 'connected';
    if (canSendViaSocket) {
      try {
        const response = await chatSocket.sendMessage(conversationId, body, {
          client_message_id: optimisticMessage?.client_message_id || undefined,
          database_id: readSelectedDatabaseId() || undefined,
          reply_to_message_id: replyToMessageId || undefined,
          body_format: bodyFormat,
        });
        serverMessage = resolveServerMessageFromSendAck(response, {
          conversationId,
          optimisticMessage,
        });
      } catch (socketError) {
        const chatErrorCode = String(socketError?.chatErrorCode || '').trim();
        if (chatErrorCode === 'validation_error' || chatErrorCode === 'forbidden') {
          throw socketError;
        }
        logChatDebug('sendMessage:socketFallback', {
          conversationId,
          chatErrorCode: chatErrorCode || undefined,
          error: String(socketError?.message || socketError),
        });
        if (!chatErrorCode) {
          // Dead transport: reconnect so following sends go over WS again.
          chatSocket.reconnectNow();
        }
      }
    }
    if (!serverMessage) {
      const httpMessage = await chatAPI.sendMessage(conversationId, body, {
        client_message_id: optimisticMessage?.client_message_id || undefined,
        reply_to_message_id: replyToMessageId || undefined,
        body_format: bodyFormat,
      });
      serverMessage = resolveServerMessageFromSendAck(
        { message: httpMessage, message_id: httpMessage?.id, ok: true },
        { conversationId, optimisticMessage },
      );
    }
    return serverMessage;
  }, [logChatDebug, readSelectedDatabaseId, socketStatusRef]);

  const sendMessage = useCallback(async () => {
    const conversationId = String(activeConversationId || '').trim();
    const rawBody = String(latestMessageTextRef.current || '');
    const body = rawBody.trim();
    if (!conversationId || !body || rawBody.length > CHAT_MESSAGE_BODY_MAX_LENGTH) return false;
    const bodyFormat = 'plain';
    const draftEditingMessage = editingMessage ? { ...editingMessage } : null;
    const draftReplyMessage = !draftEditingMessage && replyMessage ? { ...replyMessage } : null;

    if (draftEditingMessage?.id) {
      const messageId = String(draftEditingMessage.id || '').trim();
      if (!messageId) return false;
      const previousBody = String(draftEditingMessage.body || '').trim();
      if (previousBody === body) {
        setEditingMessage(null);
        setMessageText('');
        focusComposer({ forceMobile: true });
        return true;
      }
      setMessageText('');
      setEditingMessage(null);
      focusComposer({ forceMobile: true });
      try {
        const updated = await chatAPI.editChatMessage(conversationId, messageId, body, {
          body_format: bodyFormat,
        });
        if (updated?.id) {
          mergeMessageIntoThread(updated);
        }
        return true;
      } catch (error) {
        if (activeConversationIdRef.current === conversationId && !String(latestMessageTextRef.current || '').trim()) {
          setMessageText(body);
          setEditingMessage(draftEditingMessage);
          focusComposer({ forceMobile: true });
        }
        notifyApiError(error, 'Не удалось изменить сообщение.');
        return false;
      }
    }

    // R20: while a partial window is loaded (has_newer), the optimistic bubble
    // must land after the real tail — drain newer pages first so the history
    // has no gap below the viewport.
    await ensureLatestThreadWindow?.();
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
      const serverMessage = await deliverOptimisticMessage(
        conversationId,
        optimisticMessage,
        body,
        bodyFormat,
        draftReplyMessage?.id,
      );
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
        markOptimisticMessageFailed(conversationId, optimisticMessage, draftReplyMessage?.id);
      }
      return true;
    } catch (error) {
      if (optimisticMessage?.id) {
        markOptimisticMessageFailed(conversationId, optimisticMessage, draftReplyMessage?.id);
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
    ensureLatestThreadWindow,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticTextMessage,
    draftWriteTimeoutRef,
    editingMessage,
    flushDraftToStorage,
    focusComposer,
    latestMessageTextRef,
    deliverOptimisticMessage,
    logChatDebug,
    markOptimisticMessageFailed,
    mergeMessageIntoThread,
    notifyApiError,
    readSelectedDatabaseId,
    replyMessage,
    setEditingMessage,
    setMessageText,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    userId,
  ]);

  const retryFailedMessageImpl = useCallback(async (messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return false;
    let entry = null;
    for (const byConversation of failedMessagesRef.current.values()) {
      entry = byConversation.get(normalizedMessageId) || null;
      if (entry) break;
    }
    if (!entry) return false;
    // R20: same no-gap rule as fresh sends — close the newer window before the
    // re-sent bubble lands at the real end of history.
    if (entry.conversationId === String(activeConversationIdRef.current || '').trim()) {
      await ensureLatestThreadWindow?.();
    }
    const retryMessage = { ...entry.message, optimisticStatus: 'sending' };
    applyOutgoingThreadMessage(entry.conversationId, retryMessage, {
      scroll: false,
      scrollSource: 'sendMessage:retry',
    });
    // Reuse the original client_message_id so a retry is idempotent on the
    // server even if the first attempt was actually persisted.
    try {
      const serverMessage = entry.stickerResend
        ? await chatStickersAPI.sendSticker(entry.conversationId, entry.stickerResend.stickerId, {
          client_message_id: entry.clientMessageId || undefined,
          reply_to_message_id: entry.replyToMessageId || undefined,
        })
        : entry.fileResend
        ? await chatAPI.sendFiles(entry.conversationId, entry.fileResend.uploadItems, {
          client_message_id: entry.clientMessageId || undefined,
          body: entry.body,
          reply_to_message_id: entry.replyToMessageId || undefined,
          uploadAttempt: entry.fileResend.uploadAttempt,
        })
        : await deliverOptimisticMessage(
          entry.conversationId,
          retryMessage,
          entry.body,
          entry.bodyFormat,
          entry.replyToMessageId,
        );
      if (serverMessage?.id) {
        failedMessagesRef.current.get(entry.conversationId)?.delete(normalizedMessageId);
        applyOutgoingThreadMessage(entry.conversationId, serverMessage, {
          replaceId: normalizedMessageId,
          scroll: false,
          scrollSource: 'sendMessage:server',
        });
        if (activeConversation?.kind === 'ai') {
          setOptimisticAiQueuedStatus(entry.conversationId, activeConversation?.title);
        }
      } else {
        markOptimisticMessageFailed(entry.conversationId, retryMessage, entry.replyToMessageId, {
          fileResend: entry.fileResend,
          stickerResend: entry.stickerResend,
        });
      }
      return true;
    } catch (error) {
      markOptimisticMessageFailed(entry.conversationId, retryMessage, entry.replyToMessageId, {
        fileResend: entry.fileResend,
        stickerResend: entry.stickerResend,
      });
      notifyApiError(error, 'Не удалось отправить сообщение.');
      return false;
    }
  }, [
    activeConversation?.kind,
    activeConversation?.title,
    activeConversationIdRef,
    applyOutgoingThreadMessage,
    deliverOptimisticMessage,
    ensureLatestThreadWindow,
    markOptimisticMessageFailed,
    notifyApiError,
    setOptimisticAiQueuedStatus,
  ]);

  // Д2-3: идентичность колбэка не меняется между рендерами — он уходит в каждый
  // пузырь ленты, и нестабильная ссылка отменяла memo у всех сообщений на каждом
  // обновлении состояния прокрутки/догрузки.
  const retryFailedMessageRef = useRef(retryFailedMessageImpl);
  retryFailedMessageRef.current = retryFailedMessageImpl;
  const retryFailedMessage = useCallback(
    (messageId) => retryFailedMessageRef.current(messageId),
    [],
  );

  const handleComposerSend = useCallback(async () => sendMessage(), [sendMessage]);

  return {
    handleComposerSend,
    sendMessage,
    retryFailedMessage,
    discardFailedMessage,
    registerFailedOutgoingMessage,
  };
}

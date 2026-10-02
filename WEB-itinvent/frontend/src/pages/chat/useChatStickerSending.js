import { useCallback, useRef } from 'react';

import { chatStickersAPI } from '../../api/chatStickers';

export default function useChatStickerSending({
  activeConversationId,
  applyOutgoingThreadMessage,
  ensureLatestThreadWindow,
  buildReplyPreview,
  cancelPendingInitialAnchor,
  createOptimisticStickerMessage,
  notifyApiError,
  registerFailedOutgoingMessage,
  replyMessage,
  setReplyMessage,
}) {
  const stickerSendSeqRef = useRef(0);
  const stickerSendInFlightRef = useRef(false);
  return useCallback(async (sticker) => {
    const conversationId = String(activeConversationId || '').trim();
    const stickerId = String(sticker?.id || '').trim();
    // One in-flight sticker send per conversation: a double click must not
    // create a duplicate (the client_message_id also makes a retry
    // idempotent on the server).
    if (!conversationId || !stickerId || stickerSendInFlightRef.current) return false;
    stickerSendInFlightRef.current = true;
    // R20: drain newer pages first so the sticker bubble lands at the real
    // bottom of history instead of above an unloaded tail.
    await ensureLatestThreadWindow?.();
    const replyToMessageId = String(replyMessage?.id || '').trim() || undefined;
    const optimisticMessage = createOptimisticStickerMessage?.({
      conversationId,
      sticker,
      replyPreview: buildReplyPreview?.(replyMessage) || null,
    });
    stickerSendSeqRef.current += 1;
    const clientMessageId = String(optimisticMessage?.client_message_id || '').trim()
      || `chat-client:${conversationId}:${Date.now()}:${stickerSendSeqRef.current}`;
    if (optimisticMessage) {
      applyOutgoingThreadMessage(conversationId, optimisticMessage, {
        scroll: true,
        scrollSource: 'sendSticker',
      });
      setReplyMessage(null);
      cancelPendingInitialAnchor();
    }
    try {
      const message = await chatStickersAPI.sendSticker(conversationId, stickerId, {
        client_message_id: clientMessageId,
        reply_to_message_id: replyToMessageId,
      });
      if (!message?.id) {
        if (optimisticMessage?.id) {
          registerFailedOutgoingMessage?.(conversationId, optimisticMessage, {
            replyToMessageId,
            stickerResend: { stickerId },
          });
        }
        return false;
      }
      applyOutgoingThreadMessage(conversationId, message, {
        replaceId: optimisticMessage?.id,
        scroll: !optimisticMessage,
        scrollSource: 'sendSticker',
      });
      setReplyMessage(null);
      cancelPendingInitialAnchor();
      return true;
    } catch (error) {
      if (optimisticMessage?.id) {
        registerFailedOutgoingMessage?.(conversationId, optimisticMessage, {
          replyToMessageId,
          stickerResend: { stickerId },
        });
      }
      notifyApiError(error, 'Не удалось отправить стикер.');
      return false;
    } finally {
      stickerSendInFlightRef.current = false;
    }
  }, [
    activeConversationId,
    applyOutgoingThreadMessage,
    ensureLatestThreadWindow,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticStickerMessage,
    notifyApiError,
    registerFailedOutgoingMessage,
    replyMessage?.id,
    setReplyMessage,
  ]);
}

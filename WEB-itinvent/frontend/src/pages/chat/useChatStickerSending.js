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
  // Параллельная отправка разных стикеров безопасна: у каждого запроса
  // свой client_message_id, серверная дедупликация по нему идемпотентна.
  // Глобальный блок заменён на per-sticker — двойной клик по одному
  // стикеру всё ещё не создаёт дубликат.
  const inFlightStickerIdsRef = useRef(new Set());
  return useCallback(async (sticker) => {
    const conversationId = String(activeConversationId || '').trim();
    const stickerId = String(sticker?.id || '').trim();
    if (!conversationId || !stickerId || inFlightStickerIdsRef.current.has(stickerId)) return false;
    inFlightStickerIdsRef.current.add(stickerId);
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
      inFlightStickerIdsRef.current.delete(stickerId);
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

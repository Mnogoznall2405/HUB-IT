import { useCallback } from 'react';

import { chatStickersAPI } from '../../api/chatStickers';

export default function useChatStickerSending({
  activeConversationId,
  applyOutgoingThreadMessage,
  cancelPendingInitialAnchor,
  notifyApiError,
  replyMessage,
  setReplyMessage,
}) {
  return useCallback(async (sticker) => {
    const conversationId = String(activeConversationId || '').trim();
    const stickerId = String(sticker?.id || '').trim();
    if (!conversationId || !stickerId) return false;
    const replyToMessageId = String(replyMessage?.id || '').trim() || undefined;
    try {
      const message = await chatStickersAPI.sendSticker(conversationId, stickerId, {
        reply_to_message_id: replyToMessageId,
      });
      if (!message?.id) return false;
      applyOutgoingThreadMessage(conversationId, message, {
        scroll: true,
        scrollSource: 'sendSticker',
      });
      setReplyMessage(null);
      cancelPendingInitialAnchor();
      return true;
    } catch (error) {
      notifyApiError(error, 'Не удалось отправить стикер.');
      return false;
    }
  }, [
    activeConversationId,
    applyOutgoingThreadMessage,
    cancelPendingInitialAnchor,
    notifyApiError,
    replyMessage?.id,
    setReplyMessage,
  ]);
}

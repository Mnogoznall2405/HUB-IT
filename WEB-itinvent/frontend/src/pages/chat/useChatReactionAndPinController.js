import { useCallback } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatReactionAndPinController({
  activeConversationIdRef,
  notifyApiError,
  notifyInfo,
  persistPinnedMessage,
  pinnedMessage,
  revealMessage,
  setMessages,
}) {
  const handleToggleReaction = useCallback(async (messageId, emoji) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId || !messageId || !emoji) return;
    try {
      const result = await chatAPI.toggleReaction(conversationId, messageId, emoji);
      if (result?.message_id && Array.isArray(result?.reactions)) {
        setMessages((current) => current.map((msg) => (
          msg.id === result.message_id ? { ...msg, reactions: result.reactions } : msg
        )));
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось поставить реакцию.');
    }
  }, [activeConversationIdRef, notifyApiError, setMessages]);

  const handleOpenPinnedMessage = useCallback(async () => {
    const normalizedMessageId = String(pinnedMessage?.id || '').trim();
    if (!normalizedMessageId) return;
    const found = await revealMessage(normalizedMessageId);
    if (!found) {
      notifyInfo(
        'Не удалось найти закреплённое сообщение в загруженной истории.',
        { title: 'Сообщение не найдено' },
      );
    }
  }, [notifyInfo, pinnedMessage?.id, revealMessage]);

  const handleUnpinPinnedMessage = useCallback(() => {
    persistPinnedMessage(null);
  }, [persistPinnedMessage]);

  return {
    handleOpenPinnedMessage,
    handleToggleReaction,
    handleUnpinPinnedMessage,
  };
}

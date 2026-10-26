import { useCallback, useLayoutEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatReactionAndPinController({
  activeConversationIdRef,
  applyPinnedMessages,
  notifyApiError,
  notifyInfo,
  persistPinnedMessage,
  pinnedMessageMutationRef,
  pinnedMessage,
  revealMessage,
  setMessages,
}) {
  const internalPinMutationRef = useRef(0);
  const pinMutationRef = pinnedMessageMutationRef || internalPinMutationRef;
  useLayoutEffect(() => {
    pinMutationRef.current += 1;
    return () => { pinMutationRef.current += 1; };
  }, [activeConversationIdRef?.current, pinMutationRef]);
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

  const handlePollVote = useCallback(async (messageId, optionIndex) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    const index = Number(optionIndex);
    if (!conversationId || !messageId || !Number.isInteger(index) || index < 0) return;
    try {
      const result = await chatAPI.votePoll(conversationId, messageId, index);
      if (result?.message_id && result?.poll) {
        setMessages((current) => current.map((msg) => (
          msg.id === result.message_id ? { ...msg, poll: result.poll } : msg
        )));
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось проголосовать в опросе.');
    }
  }, [activeConversationIdRef, notifyApiError, setMessages]);

  const handlePollClose = useCallback(async (messageId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId || !messageId) return;
    try {
      const result = await chatAPI.closePoll(conversationId, messageId);
      if (result?.message_id && result?.poll) {
        setMessages((current) => current.map((msg) => (
          msg.id === result.message_id ? { ...msg, poll: result.poll } : msg
        )));
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось завершить опрос.');
    }
  }, [activeConversationIdRef, notifyApiError, setMessages]);

  const handleOpenPinnedMessage = useCallback(async (messageId) => {
    const normalizedMessageId = String(messageId || pinnedMessage?.id || '').trim();
    if (!normalizedMessageId) return;
    const found = await revealMessage(normalizedMessageId);
    if (!found) {
      notifyInfo(
        'Не удалось найти закреплённое сообщение в загруженной истории.',
        { title: 'Сообщение не найдено' },
      );
    }
  }, [notifyInfo, pinnedMessage?.id, revealMessage]);

  const handleUnpinPinnedMessage = useCallback(async (messageId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return;
    const normalizedMessageId = String(messageId || pinnedMessage?.id || '').trim();
    const request = ++pinMutationRef.current;
    try {
      if (normalizedMessageId) {
        const result = await chatAPI.unpinMessage(conversationId, normalizedMessageId);
        if (request === pinMutationRef.current && conversationId === activeConversationIdRef.current) {
          applyPinnedMessages(result?.items);
        }
        return;
      }
      const result = await chatAPI.setPinnedMessage(conversationId, null);
      if (request === pinMutationRef.current && conversationId === activeConversationIdRef.current) {
        persistPinnedMessage(result?.pinned_message !== undefined ? result.pinned_message : null);
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось открепить сообщение.');
    }
  }, [activeConversationIdRef, applyPinnedMessages, notifyApiError, persistPinnedMessage, pinMutationRef, pinnedMessage?.id]);

  return {
    handleOpenPinnedMessage,
    handlePollClose,
    handlePollVote,
    handleToggleReaction,
    handleUnpinPinnedMessage,
  };
}

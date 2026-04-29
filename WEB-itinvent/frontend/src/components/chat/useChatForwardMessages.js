import { startTransition, useCallback } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatForwardMessages({
  activeConversationIdRef,
  clearSelectedMessages,
  closeMessageMenu,
  forwardMessages,
  forwardingConversationId,
  loadChatDialogsModule,
  loadConversations,
  normalizeForwardMessageQueue,
  notifyApiError,
  openConversation,
  promoteConversationToTop,
  queueAutoScroll,
  setComposerMenuAnchor,
  setForwardConversationQuery,
  setForwardMessages,
  setForwardOpen,
  setForwardingConversationId,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setReplyMessage,
  setThreadMenuAnchor,
  syncConversationPreview,
  upsertThreadMessages,
}) {
  const handleForwardMessageFromMenu = useCallback((message) => {
    closeMessageMenu();
    const forwardMessageId = String(message?.id || '').trim();
    if (!forwardMessageId) return;
    void loadChatDialogsModule();
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setComposerMenuAnchor(null);
    setForwardConversationQuery('');
    setForwardMessages(normalizeForwardMessageQueue(message));
    setForwardOpen(true);
  }, [
    closeMessageMenu,
    loadChatDialogsModule,
    normalizeForwardMessageQueue,
    setComposerMenuAnchor,
    setForwardConversationQuery,
    setForwardMessages,
    setForwardOpen,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  ]);

  const handleForwardMessageToConversation = useCallback(async (conversationId) => {
    const targetConversationId = String(conversationId || '').trim();
    const messagesToForward = normalizeForwardMessageQueue(forwardMessages);
    if (!targetConversationId || messagesToForward.length <= 0 || forwardingConversationId) return;
    setForwardingConversationId(targetConversationId);
    try {
      setForwardOpen(false);
      setForwardConversationQuery('');
      const forwardedMessages = [];
      for (const sourceMessage of messagesToForward) {
        const sourceMessageId = String(sourceMessage?.id || '').trim();
        if (!sourceMessageId) continue;
        // Keep order identical to the selected thread order.
        // eslint-disable-next-line no-await-in-loop
        const forwardedMessage = await chatAPI.forwardMessage(targetConversationId, sourceMessageId);
        if (forwardedMessage?.id) forwardedMessages.push(forwardedMessage);
      }

      setForwardMessages([]);
      clearSelectedMessages();
      setReplyMessage(null);

      if (activeConversationIdRef.current === targetConversationId) {
        upsertThreadMessages(forwardedMessages);
        const lastForwardedMessage = forwardedMessages[forwardedMessages.length - 1];
        if (lastForwardedMessage?.id) {
          startTransition(() => {
            syncConversationPreview(targetConversationId, lastForwardedMessage, { unread_count: 0 });
            promoteConversationToTop(targetConversationId);
          });
        }
        queueAutoScroll('bottom_instant', 'forwardMessages', { userInitiated: true });
      } else {
        void loadConversations({ silent: true, force: true });
      }

      if (activeConversationIdRef.current !== targetConversationId) {
        openConversation(targetConversationId);
      }
    } catch (error) {
      notifyApiError(error, messagesToForward.length === 1 ? 'Не удалось переслать сообщение.' : 'Не удалось переслать выбранные сообщения.');
      setForwardOpen(true);
    } finally {
      setForwardingConversationId('');
    }
  }, [
    activeConversationIdRef,
    clearSelectedMessages,
    forwardMessages,
    forwardingConversationId,
    loadConversations,
    normalizeForwardMessageQueue,
    notifyApiError,
    openConversation,
    promoteConversationToTop,
    queueAutoScroll,
    setForwardConversationQuery,
    setForwardMessages,
    setForwardOpen,
    setForwardingConversationId,
    setReplyMessage,
    syncConversationPreview,
    upsertThreadMessages,
  ]);

  return {
    handleForwardMessageFromMenu,
    handleForwardMessageToConversation,
  };
}

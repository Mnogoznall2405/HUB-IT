import { startTransition, useCallback, useRef } from 'react';

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
  const batchRef = useRef(null);
  const busyRef = useRef(false);
  const currentQueueRef = useRef(forwardMessages);
  currentQueueRef.current = forwardMessages;
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
    if (!targetConversationId || messagesToForward.length <= 0 || forwardingConversationId || busyRef.current) return;
    busyRef.current = true;
    const sourceConversationId = activeConversationIdRef.current;
    if (batchRef.current?.queue !== forwardMessages || batchRef.current?.target !== targetConversationId) {
      batchRef.current = { queue: forwardMessages, target: targetConversationId, entries: new Map() };
    }
    const batch = batchRef.current;
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
        let entry = batch.entries.get(sourceMessageId);
        if (!entry) {
          entry = { key: globalThis.crypto?.randomUUID?.() || `forward-${Date.now()}-${Math.random().toString(36).slice(2)}` };
          batch.entries.set(sourceMessageId, entry);
        }
        const forwardedMessage = entry.message || await chatAPI.forwardMessage(targetConversationId, sourceMessageId, {
          client_message_id: entry.key,
        });
        entry.message = forwardedMessage;
        if (forwardedMessage?.id) forwardedMessages.push(forwardedMessage);
      }

      if (currentQueueRef.current === forwardMessages) setForwardMessages([]);
      if (activeConversationIdRef.current === sourceConversationId) {
        clearSelectedMessages();
        setReplyMessage(null);
      }
      batchRef.current = null;

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
        void Promise.resolve(loadConversations({ silent: true, force: true })).catch(() => {});
      }

      if (activeConversationIdRef.current === sourceConversationId && sourceConversationId !== targetConversationId) {
        openConversation(targetConversationId);
      }
    } catch (error) {
      notifyApiError(error, messagesToForward.length === 1 ? 'Не удалось переслать сообщение.' : 'Не удалось переслать выбранные сообщения.');
      if (currentQueueRef.current === forwardMessages) setForwardOpen(true);
    } finally {
      busyRef.current = false;
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

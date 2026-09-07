import { useCallback, useLayoutEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { canDeleteChatMessage, getMessagePreview } from './chatHelpers';

export default function useChatSelectedMessageActions({
  activeConversationIdRef,
  clearSelectedMessages,
  conversationKind,
  focusComposer,
  loadChatDialogsModule,
  mergeMessageIntoThread,
  normalizeForwardMessageQueue,
  notifyApiError,
  notifyWarning,
  selectedMessages,
  setComposerMenuAnchor,
  setForwardConversationQuery,
  setForwardMessages,
  setForwardOpen,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setReplyMessage,
  setThreadMenuAnchor,
}) {
  const selectionGeneration = useRef(0);
  const selectionKey = selectedMessages.map(message => message.id).join(',');
  useLayoutEffect(() => {
    selectionGeneration.current += 1;
    return () => { selectionGeneration.current += 1; };
  }, [selectionKey, activeConversationIdRef?.current]);
  const replyToSelectedMessage = useCallback(() => {
    if (selectedMessages.length !== 1) return;
    const [message] = selectedMessages;
    if (!message?.id) return;
    setReplyMessage(message);
    clearSelectedMessages();
    focusComposer({ forceMobile: true });
  }, [clearSelectedMessages, focusComposer, selectedMessages, setReplyMessage]);

  const copySelectedMessages = useCallback(async () => {
    const generation = selectionGeneration.current;
    const text = selectedMessages
      .map((message) => String(getMessagePreview(message) || '').trim())
      .filter(Boolean)
      .join('\n\n');
    if (!text) {
      notifyWarning('В выбранных сообщениях нет текста для копирования.');
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      notifyWarning('Буфер обмена недоступен в этом браузере.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (selectionGeneration.current === generation) clearSelectedMessages();
    } catch {
      notifyWarning('Не удалось скопировать выбранные сообщения.');
    }
  }, [clearSelectedMessages, notifyWarning, selectedMessages]);

  const openForwardSelectedMessages = useCallback(() => {
    if (selectedMessages.length <= 0) return;
    void loadChatDialogsModule();
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setComposerMenuAnchor(null);
    setForwardConversationQuery('');
    setForwardMessages(normalizeForwardMessageQueue(selectedMessages));
    setForwardOpen(true);
  }, [
    loadChatDialogsModule,
    normalizeForwardMessageQueue,
    selectedMessages,
    setComposerMenuAnchor,
    setForwardConversationQuery,
    setForwardMessages,
    setForwardOpen,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  ]);

  const deleteSelectedMessages = useCallback(async () => {
    const generation = selectionGeneration.current;
    const sourceConversationId = activeConversationIdRef?.current;
    const deletable = selectedMessages.filter((message) => (
      canDeleteChatMessage(message, { conversationKind })
    ));
    if (deletable.length <= 0) return;
    const confirmLabel = deletable.length === 1
      ? 'Удалить сообщение?'
      : `Удалить ${deletable.length} сообщений?`;
    if (typeof window !== 'undefined' && !window.confirm(confirmLabel)) return;

    try {
      for (const message of deletable) {
        const conversationId = String(message?.conversation_id || sourceConversationId || '').trim();
        const messageId = String(message?.id || '').trim();
        if (!conversationId || !messageId) continue;
        const updated = await chatAPI.deleteChatMessage(conversationId, messageId);
        mergeMessageIntoThread?.(updated);
      }
      if (selectionGeneration.current === generation
        && activeConversationIdRef?.current === sourceConversationId) clearSelectedMessages();
    } catch (error) {
      notifyApiError?.(error, 'Не удалось удалить сообщение.');
    }
  }, [
    activeConversationIdRef,
    clearSelectedMessages,
    conversationKind,
    mergeMessageIntoThread,
    notifyApiError,
    selectedMessages,
  ]);

  return {
    copySelectedMessages,
    deleteSelectedMessages,
    openForwardSelectedMessages,
    replyToSelectedMessage,
  };
}

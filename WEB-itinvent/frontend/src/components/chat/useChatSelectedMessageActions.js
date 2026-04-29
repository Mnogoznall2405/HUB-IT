import { useCallback } from 'react';

import { getMessagePreview } from './chatHelpers';

export default function useChatSelectedMessageActions({
  clearSelectedMessages,
  focusComposer,
  loadChatDialogsModule,
  normalizeForwardMessageQueue,
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
  const replyToSelectedMessage = useCallback(() => {
    if (selectedMessages.length !== 1) return;
    const [message] = selectedMessages;
    if (!message?.id) return;
    setReplyMessage(message);
    clearSelectedMessages();
    focusComposer({ forceMobile: true });
  }, [clearSelectedMessages, focusComposer, selectedMessages, setReplyMessage]);

  const copySelectedMessages = useCallback(async () => {
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
      clearSelectedMessages();
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

  return {
    copySelectedMessages,
    openForwardSelectedMessages,
    replyToSelectedMessage,
  };
}

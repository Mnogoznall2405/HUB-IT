import { useCallback, useRef } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatReadReceiptsBridge({
  activeConversationIdRef,
  loadChatDialogsModule,
  loadConversations,
  loadMessages,
  notifyApiError,
  setMessageReadsItems,
  setMessageReadsLoading,
  setMessageReadsMessage,
  setMessageReadsOpen,
  sidebarSearchActive,
  syncConversationUnreadState,
}) {
  const messageReadsRequestRef = useRef(0);
  const handleOptimisticRead = useCallback((readMessageId) => {
    const normalizedConversationId = String(activeConversationIdRef.current || '').trim();
    const normalizedReadMessageId = String(readMessageId || '').trim();
    if (!normalizedConversationId || !normalizedReadMessageId) return;
    syncConversationUnreadState(normalizedConversationId, normalizedReadMessageId);
  }, [activeConversationIdRef, syncConversationUnreadState]);

  const handleReadReceiptsSyncError = useCallback(() => {
    if (activeConversationIdRef.current) {
      void loadMessages(activeConversationIdRef.current, {
        silent: true,
        reason: 'read-receipts:revalidate',
        force: true,
      }).catch(() => {});
    }
    if (!sidebarSearchActive) {
      void loadConversations({ silent: true, force: true }).catch(() => {});
    }
  }, [activeConversationIdRef, loadConversations, loadMessages, sidebarSearchActive]);

  const openMessageReads = useCallback(async (message) => {
    void loadChatDialogsModule();
    const messageId = String(message?.id || '').trim();
    if (!messageId) return;
    setMessageReadsMessage(message || null);
    setMessageReadsItems([]);
    setMessageReadsLoading(true);
    setMessageReadsOpen(true);
    const requestId = ++messageReadsRequestRef.current;
    try {
      const data = await chatAPI.getMessageReads(messageId);
      if (requestId !== messageReadsRequestRef.current) return;
      setMessageReadsItems(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      if (requestId !== messageReadsRequestRef.current) return;
      notifyApiError(error, 'Не удалось загрузить список прочитавших.');
      setMessageReadsOpen(false);
    } finally {
      if (requestId === messageReadsRequestRef.current) setMessageReadsLoading(false);
    }
  }, [
    loadChatDialogsModule,
    notifyApiError,
    setMessageReadsItems,
    setMessageReadsLoading,
    setMessageReadsMessage,
    setMessageReadsOpen,
  ]);

  return {
    handleOptimisticRead,
    handleReadReceiptsSyncError,
    openMessageReads,
  };
}

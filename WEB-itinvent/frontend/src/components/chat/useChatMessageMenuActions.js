import { useCallback } from 'react';

import { getMessagePreview } from './chatHelpers';

export default function useChatMessageMenuActions({
  activeConversationIdRef,
  buildPinnedMessagePayload,
  focusComposer,
  loadChatDialogsModule,
  notifyInfo,
  notifyWarning,
  openMediaViewer,
  openMessageReads,
  openTaskFromChat,
  persistPinnedMessage,
  pinnedMessage,
  setComposerMenuAnchor,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setReplyMessage,
  setSelectedMessageIds,
  setThreadMenuAnchor,
}) {
  const closeMessageMenu = useCallback(() => {
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
  }, [setMessageMenuAnchor, setMessageMenuMessage]);

  const clearSelectedMessages = useCallback(() => {
    setSelectedMessageIds([]);
  }, [setSelectedMessageIds]);

  const toggleMessageSelection = useCallback((message) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId) return;
    setSelectedMessageIds((current) => {
      const source = Array.isArray(current) ? current : [];
      if (source.includes(messageId)) {
        return source.filter((id) => id !== messageId);
      }
      return [...source, messageId];
    });
  }, [setSelectedMessageIds]);

  const startMessageSelection = useCallback((message) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId) return;
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setComposerMenuAnchor(null);
    setSelectedMessageIds((current) => {
      const source = Array.isArray(current) ? current : [];
      return source.includes(messageId) ? source : [...source, messageId];
    });
  }, [setComposerMenuAnchor, setMessageMenuAnchor, setMessageMenuMessage, setSelectedMessageIds]);

  const openMessageMenu = useCallback((message, anchorTarget) => {
    void loadChatDialogsModule();
    if (!message?.id || !anchorTarget) return;
    setThreadMenuAnchor(null);
    setComposerMenuAnchor(null);
    setMessageMenuMessage(message);
    if (anchorTarget?.nodeType === 1) {
      setMessageMenuAnchor({
        anchorEl: anchorTarget,
        anchorPosition: null,
      });
      return;
    }
    const anchorEl = anchorTarget?.anchorEl?.nodeType === 1 ? anchorTarget.anchorEl : null;
    const anchorPosition = anchorTarget?.anchorPosition && Number.isFinite(Number(anchorTarget.anchorPosition.top))
      && Number.isFinite(Number(anchorTarget.anchorPosition.left))
      ? {
          top: Math.round(Number(anchorTarget.anchorPosition.top || 0)),
          left: Math.round(Number(anchorTarget.anchorPosition.left || 0)),
        }
      : null;
    if (!anchorEl && !anchorPosition) return;
    setMessageMenuAnchor({
      anchorEl,
      anchorPosition,
      anchorReference: anchorPosition ? 'anchorPosition' : 'anchorEl',
    });
  }, [loadChatDialogsModule, setComposerMenuAnchor, setMessageMenuAnchor, setMessageMenuMessage, setThreadMenuAnchor]);

  const handleReplyMessage = useCallback((message) => {
    if (!message || !message.id) return;
    setReplyMessage(message);
    focusComposer();
  }, [focusComposer, setReplyMessage]);

  const handleReplyFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    handleReplyMessage(message);
  }, [closeMessageMenu, handleReplyMessage]);

  const handleCopyMessage = useCallback(async (message) => {
    closeMessageMenu();
    const text = String(getMessagePreview(message) || '').trim();
    if (!text) return;
    if (!navigator?.clipboard?.writeText) {
      notifyWarning('Буфер обмена недоступен в этом браузере.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      notifyWarning('Не удалось скопировать сообщение.');
    }
  }, [closeMessageMenu, notifyWarning]);

  const handleCopyMessageLink = useCallback(async (message) => {
    closeMessageMenu();
    const messageId = String(message?.id || '').trim();
    const conversationId = String(message?.conversation_id || activeConversationIdRef.current || '').trim();
    if (!messageId || !conversationId) return;
    if (!navigator?.clipboard?.writeText || typeof window === 'undefined') {
      notifyWarning('Буфер обмена недоступен в этом браузере.');
      return;
    }
    try {
      const link = new URL('/chat', window.location.origin);
      link.searchParams.set('conversation', conversationId);
      link.searchParams.set('message', messageId);
      await navigator.clipboard.writeText(link.toString());
    } catch {
      notifyWarning('Не удалось скопировать ссылку на сообщение.');
    }
  }, [activeConversationIdRef, closeMessageMenu, notifyWarning]);

  const handleTogglePinMessageFromMenu = useCallback((message) => {
    closeMessageMenu();
    const nextPinnedMessage = buildPinnedMessagePayload(message);
    if (!nextPinnedMessage) return;
    const currentPinnedMessageId = String(pinnedMessage?.id || '').trim();
    if (currentPinnedMessageId && currentPinnedMessageId === nextPinnedMessage.id) {
      persistPinnedMessage(null);
      return;
    }
    persistPinnedMessage(nextPinnedMessage);
  }, [buildPinnedMessagePayload, closeMessageMenu, persistPinnedMessage, pinnedMessage?.id]);

  const handleReportMessageFromMenu = useCallback(async (message) => {
    closeMessageMenu();
    const messageId = String(message?.id || '').trim();
    const conversationId = String(message?.conversation_id || activeConversationIdRef.current || '').trim();
    if (!messageId || !conversationId || typeof window === 'undefined') {
      notifyInfo('Автоматическая отправка жалоб пока не подключена.', { title: 'Пожаловаться' });
      return;
    }
    const link = new URL('/chat', window.location.origin);
    link.searchParams.set('conversation', conversationId);
    link.searchParams.set('message', messageId);
    const preview = String(getMessagePreview(message) || '').trim();
    const senderName = String(message?.sender?.full_name || message?.sender?.username || '').trim();
    const reportPayload = [
      'Жалоба на сообщение',
      senderName ? `Отправитель: ${senderName}` : '',
      preview ? `Текст: ${preview}` : '',
      `Ссылка: ${link.toString()}`,
    ].filter(Boolean).join('\n');
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(reportPayload);
        notifyInfo('Данные сообщения скопированы. Жалобу можно передать модератору вручную.', { title: 'Пожаловаться' });
        return;
      } catch {
        // Fall through to the generic hint below.
      }
    }
    notifyInfo('Автоматическая отправка жалоб пока не подключена.', { title: 'Пожаловаться' });
  }, [activeConversationIdRef, closeMessageMenu, notifyInfo]);

  const handleSelectMessageFromMenu = useCallback((message) => {
    closeMessageMenu();
    startMessageSelection(message);
  }, [closeMessageMenu, startMessageSelection]);

  const handleOpenReadsFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    void openMessageReads(message);
  }, [closeMessageMenu, openMessageReads]);

  const handleOpenAttachmentFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    const firstAttachment = Array.isArray(message?.attachments) ? message.attachments[0] : null;
    if (!message?.id || !firstAttachment?.id) return;
    openMediaViewer(message.id, firstAttachment);
  }, [closeMessageMenu, openMediaViewer]);

  const handleOpenTaskFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    const taskId = String(message?.task_preview?.id || '').trim();
    if (!taskId) return;
    openTaskFromChat(taskId);
  }, [closeMessageMenu, openTaskFromChat]);

  return {
    clearSelectedMessages,
    closeMessageMenu,
    handleCopyMessage,
    handleCopyMessageLink,
    handleOpenAttachmentFromMessageMenu,
    handleOpenReadsFromMessageMenu,
    handleOpenTaskFromMessageMenu,
    handleReplyFromMessageMenu,
    handleReplyMessage,
    handleReportMessageFromMenu,
    handleSelectMessageFromMenu,
    handleTogglePinMessageFromMenu,
    openMessageMenu,
    startMessageSelection,
    toggleMessageSelection,
  };
}

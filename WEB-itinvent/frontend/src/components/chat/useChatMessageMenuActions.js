import { useCallback, useLayoutEffect, useRef } from 'react';

import { chatAPI } from '../../api/client';
import { getMessagePreview } from './chatHelpers';
import { requestMessageReport } from './chatReportRequest';

/**
 * Общий вход в режим редактирования: пункт «Изменить» меню сообщения и ↑ в пустом композере.
 */
export function startChatMessageEditing({
  message,
  focusComposer,
  setEditingMessage,
  setMessageText,
  setReplyMessage,
}) {
  if (!message?.id) return false;
  setReplyMessage(null);
  setEditingMessage(message);
  setMessageText(String(message?.body || '').trim());
  focusComposer({ forceMobile: true });
  return true;
}

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
  applyPinnedMessages,
  persistPinnedMessage,
  pinnedMessageMutationRef,
  pinnedMessage,
  pinnedMessages,
  setComposerMenuAnchor,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setEditingMessage,
  setMessageText,
  setReplyMessage,
  setSelectedMessageIds,
  setThreadMenuAnchor,
}) {
  const internalPinMutationRef = useRef(0);
  const pinMutationRef = pinnedMessageMutationRef || internalPinMutationRef;
  useLayoutEffect(() => {
    pinMutationRef.current += 1;
    return () => { pinMutationRef.current += 1; };
  }, [activeConversationIdRef?.current, pinMutationRef]);
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
    setEditingMessage(null);
    setReplyMessage(message);
    focusComposer();
  }, [focusComposer, setEditingMessage, setReplyMessage]);

  const handleReplyFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    handleReplyMessage(message);
  }, [closeMessageMenu, handleReplyMessage]);

  const handleEditFromMessageMenu = useCallback((message) => {
    closeMessageMenu();
    startChatMessageEditing({
      message,
      focusComposer,
      setEditingMessage,
      setMessageText,
      setReplyMessage,
    });
  }, [closeMessageMenu, focusComposer, setEditingMessage, setMessageText, setReplyMessage]);

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
      return;
    }
    notifyInfo?.('Скопировано', { durationMs: 2000, dedupeMode: 'recent' });
  }, [closeMessageMenu, notifyInfo, notifyWarning]);

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

  const handleTogglePinMessageFromMenu = useCallback(async (message) => {
    closeMessageMenu();
    const nextPinnedMessage = buildPinnedMessagePayload(message);
    if (!nextPinnedMessage) return;
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return;
    const alreadyPinned = String(pinnedMessage?.id || '').trim() === nextPinnedMessage.id
      || (Array.isArray(pinnedMessages) && pinnedMessages.some((item) => item?.id === nextPinnedMessage.id));
    const request = ++pinMutationRef.current;
    try {
      const result = alreadyPinned
        ? await chatAPI.unpinMessage(conversationId, nextPinnedMessage.id)
        : await chatAPI.pinMessage(conversationId, nextPinnedMessage.id);
      if (request === pinMutationRef.current && conversationId === activeConversationIdRef.current) {
        applyPinnedMessages(result?.items);
      }
    } catch (error) {
      const reason = String(error?.response?.data?.detail || '').trim();
      notifyWarning(reason || (alreadyPinned ? 'Не удалось открепить сообщение на сервере.' : 'Не удалось закрепить сообщение на сервере.'));
    }
  }, [activeConversationIdRef, applyPinnedMessages, buildPinnedMessagePayload, closeMessageMenu, notifyWarning, pinMutationRef, pinnedMessage?.id, pinnedMessages]);

  // The report dialog (mounted with the chat dialogs) sends the complaint to the group managers.
  const handleReportMessageFromMenu = useCallback((message) => {
    closeMessageMenu();
    requestMessageReport({
      ...message,
      conversation_id: message?.conversation_id || activeConversationIdRef.current,
    });
  }, [activeConversationIdRef, closeMessageMenu]);

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
    handleEditFromMessageMenu,
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

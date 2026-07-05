import { useCallback, useEffect, useMemo, useState } from 'react';

import { chatAPI } from '../../api/client';
import useChatForwardMessages from '../../components/chat/useChatForwardMessages';
import useChatMessageMenuActions from '../../components/chat/useChatMessageMenuActions';
import useChatSelectedMessageActions from '../../components/chat/useChatSelectedMessageActions';
import { normalizeForwardMessageQueue } from './chatThreadMessages';

export default function useChatMessageActionsController({
  activeConversationId,
  activeConversationIdRef,
  buildPinnedMessagePayload,
  conversations,
  focusComposer,
  loadChatDialogsModule,
  loadConversations,
  mergeMessageIntoThread,
  messages,
  notifyApiError,
  notifyInfo,
  notifyWarning,
  openMediaViewer,
  openMessageReads,
  openTaskFromChat,
  openConversation,
  patchThreadMessage,
  persistPinnedMessage,
  pinnedMessage,
  promoteConversationToTop,
  queueAutoScroll,
  selectedMessages,
  setComposerMenuAnchor,
  setEditingMessage,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setMessageText,
  setReplyMessage,
  setSelectedMessageIds,
  setThreadMenuAnchor,
  syncConversationPreview,
  upsertThreadMessages,
}) {
  const [mailActionEditor, setMailActionEditor] = useState(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardConversationQuery, setForwardConversationQuery] = useState('');
  const [forwardingConversationId, setForwardingConversationId] = useState('');
  const [forwardMessages, setForwardMessages] = useState([]);

  useEffect(() => {
    setForwardMessages([]);
  }, [activeConversationId]);

  const patchAiActionCard = useCallback((messageId, actionCard) => {
    const normalizedMessageId = String(messageId || actionCard?.message_id || '').trim();
    if (!normalizedMessageId || !actionCard) return;
    patchThreadMessage(normalizedMessageId, { action_card: actionCard });
  }, [patchThreadMessage]);

  const confirmAiAction = useCallback(async (actionCard, message, payloadOverrides = undefined) => {
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    try {
      const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
      patchAiActionCard(message?.id, updated);
      if (String(updated?.status || '').trim() === 'expired') {
        notifyApiError(new Error('Срок действия карточки истек.'), 'Действие не выполнено.');
      } else if (String(updated?.status || '').trim() === 'failed') {
        notifyApiError(new Error(updated?.error_text || 'Ошибка выполнения.'), 'Действие не выполнено.');
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось подтвердить действие ITinvent.');
    }
  }, [notifyApiError, patchAiActionCard]);

  const editAiAction = useCallback((actionCard, message) => {
    if (!String(actionCard?.action_type || '').startsWith('office.mail.')) return;
    setMailActionEditor({ actionCard, message });
  }, []);

  const chatMailAttachmentOptions = useMemo(() => (
    (Array.isArray(messages) ? messages : []).flatMap((message) => (
      (Array.isArray(message?.attachments) ? message.attachments : []).map((attachment) => ({
        message_id: String(message?.id || '').trim(),
        attachment_id: String(attachment?.id || '').trim(),
        file_name: String(attachment?.file_name || attachment?.name || '').trim(),
        file_size: Number(attachment?.file_size || attachment?.size || 0) || 0,
      }))
    )).filter((item) => item.message_id && item.attachment_id)
  ), [messages]);

  const submitMailActionEdit = useCallback(async (payloadOverrides) => {
    const actionCard = mailActionEditor?.actionCard;
    const message = mailActionEditor?.message;
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
    patchAiActionCard(message?.id, updated);
    if (String(updated?.status || '').trim() !== 'confirmed') {
      throw new Error(updated?.error_text || 'Письмо не отправлено.');
    }
    setMailActionEditor(null);
  }, [mailActionEditor, patchAiActionCard]);

  const cancelAiAction = useCallback(async (actionCard, message) => {
    const actionId = String(actionCard?.id || '').trim();
    if (!actionId) return;
    try {
      const updated = await chatAPI.cancelAiAction(actionId);
      patchAiActionCard(message?.id, updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось отменить действие ITinvent.');
    }
  }, [notifyApiError, patchAiActionCard]);

  const {
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
  } = useChatMessageMenuActions({
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
    setEditingMessage,
    setMessageText,
    setReplyMessage,
    setSelectedMessageIds,
    setThreadMenuAnchor,
  });

  const handleDeleteMessageFromMenu = useCallback(async (message) => {
    const conversationId = String(message?.conversation_id || activeConversationIdRef.current || '').trim();
    const messageId = String(message?.id || '').trim();
    closeMessageMenu();
    if (!conversationId || !messageId) return;
    if (typeof window !== 'undefined' && !window.confirm('Удалить сообщение?')) return;
    try {
      const updated = await chatAPI.deleteChatMessage(conversationId, messageId);
      mergeMessageIntoThread(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить сообщение.');
    }
  }, [activeConversationIdRef, closeMessageMenu, mergeMessageIntoThread, notifyApiError]);

  const {
    copySelectedMessages: selectedCopySelectedMessages,
    openForwardSelectedMessages: selectedOpenForwardSelectedMessages,
    replyToSelectedMessage: selectedReplyToSelectedMessage,
  } = useChatSelectedMessageActions({
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
  });

  const {
    handleForwardMessageFromMenu: forwardHookMessageFromMenu,
    handleForwardMessageToConversation: forwardHookMessageToConversation,
  } = useChatForwardMessages({
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
  });

  const closeForwardDialog = useCallback(() => {
    if (forwardingConversationId) return;
    setForwardOpen(false);
    setForwardConversationQuery('');
    setForwardMessages([]);
  }, [forwardingConversationId]);

  const forwardTargets = useMemo(() => {
    const normalizedQuery = String(forwardConversationQuery || '').trim().toLowerCase();
    return conversations.filter((item) => {
      if (!item || item?.is_archived) return false;
      if (String(item?.id || '').trim() === String(activeConversationId || '').trim()) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        item?.title,
        item?.direct_peer?.full_name,
        item?.direct_peer?.username,
        item?.last_message_preview,
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [activeConversationId, conversations, forwardConversationQuery]);

  return {
    cancelAiAction,
    chatMailAttachmentOptions,
    clearSelectedMessages,
    closeForwardDialog,
    closeMessageMenu,
    confirmAiAction,
    editAiAction,
    forwardConversationQuery,
    forwardHookMessageFromMenu,
    forwardHookMessageToConversation,
    forwardMessages,
    forwardOpen,
    forwardTargets,
    forwardingConversationId,
    handleCopyMessage,
    handleCopyMessageLink,
    handleDeleteMessageFromMenu,
    handleEditFromMessageMenu,
    handleForwardMessageFromMenu: forwardHookMessageFromMenu,
    handleForwardMessageToConversation: forwardHookMessageToConversation,
    handleOpenAttachmentFromMessageMenu,
    handleOpenReadsFromMessageMenu,
    handleOpenTaskFromMessageMenu,
    handleReplyFromMessageMenu,
    handleReplyMessage,
    handleReportMessageFromMenu,
    handleSelectMessageFromMenu,
    handleTogglePinMessageFromMenu,
    mailActionEditor,
    openMessageMenu,
    selectedCopySelectedMessages,
    selectedOpenForwardSelectedMessages,
    selectedReplyToSelectedMessage,
    setForwardConversationQuery,
    setMailActionEditor,
    startMessageSelection,
    submitMailActionEdit,
    toggleMessageSelection,
  };
}

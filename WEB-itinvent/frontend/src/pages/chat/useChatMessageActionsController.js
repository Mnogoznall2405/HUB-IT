import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import { classifyMailSendError, MAIL_SEND_OUTCOME, MAIL_SEND_MAYBE_SENT_MESSAGE } from '../../components/mail/mailSendOutcome';
import { CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT } from '../../lib/chatSocket';
import { buildSandboxPermissionCard } from '../../components/chat/sandboxPermissionCard';
import { useConfirmDialog } from '../../components/feedback/ConfirmDialogProvider';
import useChatForwardMessages from '../../components/chat/useChatForwardMessages';
import useChatMessageMenuActions from '../../components/chat/useChatMessageMenuActions';
import useChatSelectedMessageActions from '../../components/chat/useChatSelectedMessageActions';
import { normalizeForwardMessageQueue } from './chatThreadMessages';

export default function useChatMessageActionsController({
  activeConversationId,
  activeConversationIdRef,
  buildPinnedMessagePayload,
  conversationKind,
  viewerMemberRole,
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
  pinnedMessageMutationRef,
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
  const { confirm: confirmDialog } = useConfirmDialog();
  const [mailActionEditor, setMailActionEditor] = useState(null);
  const latestMessagesRef = useRef(messages);
  latestMessagesRef.current = messages;
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

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!normalizedConversationId || typeof patchThreadMessage !== 'function') return undefined;
    const handleSandboxPermissionUpdate = (event) => {
      const card = buildSandboxPermissionCard({
        envelope: event?.detail || {},
        activeConversationId: normalizedConversationId,
      });
      if (card) patchAiActionCard(card.message_id, card);
    };
    window.addEventListener(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, handleSandboxPermissionUpdate);
    return () => window.removeEventListener(CHAT_SOCKET_AI_SANDBOX_UPDATED_EVENT, handleSandboxPermissionUpdate);
  }, [activeConversationId, patchThreadMessage]);

  const confirmingAiActionIdsRef = useRef(new Set());
  const reconcileMailConfirmationError = useCallback(async (card, message, error) => {
    if (!String(card?.action_type || '').startsWith('office.mail.')
      || classifyMailSendError(error) !== MAIL_SEND_OUTCOME.MAYBE_SENT) return false;
    setMailActionEditor((current) => current?.actionCard?.id === card.id ? null : current);
    const conversationId = String(message?.conversation_id || card.conversation_id || '').trim();
    try {
      if (conversationId && message?.id && typeof chatAPI.hydrateThreadMessages === 'function') {
        const data = await chatAPI.hydrateThreadMessages(conversationId, [message.id]);
        const fresh = data?.items?.find((item) => item.message_id === message.id)?.action_card;
        if (fresh?.id === card.id) {
          patchAiActionCard(message.id, fresh);
          if (fresh.status !== 'confirmed') notifyApiError(new Error(fresh.error_text || 'Подтверждение не завершено. Проверьте состояние карточки.'));
          return true;
        }
      }
    } catch { /* Keep the outcome unknown until an authoritative read succeeds. */ }
    const latest = latestMessagesRef.current?.find((item) => item.id === message?.id)?.action_card;
    if (latest?.id === card.id && latest.status === 'confirmed') return true;
    if (!latest || latest.id === card.id) {
      patchAiActionCard(message?.id, { ...card, status: 'failed',
        result: { ...(card.result || {}), send_outcome: 'unknown' }, error_text: MAIL_SEND_MAYBE_SENT_MESSAGE });
    }
    notifyApiError(new Error(MAIL_SEND_MAYBE_SENT_MESSAGE));
    return true;
  }, [notifyApiError, patchAiActionCard]);
  const confirmAiAction = useCallback(async (actionCard, message, payloadOverrides = undefined) => {
    const actionId = String(actionCard?.id || '').trim();
    // A repeated call for the same card (double click, re-render race) must not send twice.
    if (!actionId || confirmingAiActionIdsRef.current.has(actionId)) return;
    confirmingAiActionIdsRef.current.add(actionId);
    try {
      const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
      patchAiActionCard(message?.id, updated);
      if (String(updated?.status || '').trim() === 'expired') {
        notifyApiError(new Error('Срок действия карточки истек.'), 'Действие не выполнено.');
      } else if (String(updated?.status || '').trim() === 'failed') {
        notifyApiError(new Error(updated?.error_text || 'Ошибка выполнения.'), 'Действие не выполнено.');
      }
    } catch (error) {
      if (await reconcileMailConfirmationError(actionCard, message, error)) return;
      notifyApiError(error, 'Не удалось подтвердить действие ITinvent.');
    } finally {
      confirmingAiActionIdsRef.current.delete(actionId);
    }
  }, [notifyApiError, patchAiActionCard, reconcileMailConfirmationError]);

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
    if (!actionId || confirmingAiActionIdsRef.current.has(actionId)) return;
    confirmingAiActionIdsRef.current.add(actionId);
    let confirmationReceived = false;
    try {
      const updated = await chatAPI.confirmAiAction(actionId, payloadOverrides);
      confirmationReceived = Boolean(updated?.status);
      patchAiActionCard(message?.id, updated);
      if (updated?.result?.send_outcome === 'unknown') {
        setMailActionEditor((current) => current?.actionCard?.id === actionId ? null : current);
        notifyApiError(new Error(updated.error_text || MAIL_SEND_MAYBE_SENT_MESSAGE));
        return;
      }
      if (String(updated?.status || '').trim() !== 'confirmed') {
        throw new Error(updated?.error_text || 'Письмо не отправлено.');
      }
      setMailActionEditor(null);
    } catch (error) {
      if (!confirmationReceived && await reconcileMailConfirmationError(actionCard, message, error)) return;
      throw error;
    } finally {
      confirmingAiActionIdsRef.current.delete(actionId);
    }
  }, [mailActionEditor, patchAiActionCard, notifyApiError, reconcileMailConfirmationError]);

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
    pinnedMessageMutationRef,
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
    const confirmed = await confirmDialog({
      title: 'Удалить сообщение?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const updated = await chatAPI.deleteChatMessage(conversationId, messageId);
      mergeMessageIntoThread(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить сообщение.');
    }
  }, [activeConversationIdRef, closeMessageMenu, confirmDialog, mergeMessageIntoThread, notifyApiError]);

  const {
    copySelectedMessages: selectedCopySelectedMessages,
    deleteSelectedMessages: selectedDeleteSelectedMessages,
    openForwardSelectedMessages: selectedOpenForwardSelectedMessages,
    replyToSelectedMessage: selectedReplyToSelectedMessage,
  } = useChatSelectedMessageActions({
    activeConversationIdRef,
    clearSelectedMessages,
    conversationKind,
    viewerMemberRole,
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
    setEditingMessage,
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
    selectedDeleteSelectedMessages,
    selectedOpenForwardSelectedMessages,
    selectedReplyToSelectedMessage,
    setForwardConversationQuery,
    setMailActionEditor,
    startMessageSelection,
    submitMailActionEdit,
    toggleMessageSelection,
  };
}

import { useCallback, useState } from 'react';

export default function useMailSelectedPreviewActions({
  afterListMutation,
  clearSelection,
  getMailErrorDetail,
  handleMailCredentialsRequired,
  mailAPI,
  moveTarget = '',
  performMailReadMutation,
  selectedConversation,
  selectedMessage,
  setError,
  viewMode = 'messages',
  withActiveMailboxPayload,
} = {}) {
  const [messageActionLoading, setMessageActionLoading] = useState(false);

  const handleActionError = useCallback(async (requestError, fallbackMessage) => {
    if (await handleMailCredentialsRequired(requestError, fallbackMessage)) return;
    setError(getMailErrorDetail(requestError, fallbackMessage));
  }, [getMailErrorDetail, handleMailCredentialsRequired, setError]);

  const runSelectedMessageMutation = useCallback(async (operation, errorMessage) => {
    if (!selectedMessage?.id) return;
    setMessageActionLoading(true);
    try {
      await operation(String(selectedMessage.id));
      clearSelection({ mode: viewMode });
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, errorMessage);
    } finally {
      setMessageActionLoading(false);
    }
  }, [afterListMutation, clearSelection, handleActionError, selectedMessage?.id, viewMode]);

  const handleToggleReadState = useCallback(async () => {
    setMessageActionLoading(true);
    try {
      if (viewMode === 'conversations') {
        await performMailReadMutation({
          mode: 'conversations',
          targetId: String(selectedConversation?.conversation_id || ''),
          nextIsRead: Number(selectedConversation?.unread_count || 0) > 0,
          currentUnreadCount: Number(selectedConversation?.unread_count || 0),
          currentMessageCount: Number(selectedConversation?.messages_count || selectedConversation?.items?.length || 1),
          errorMessage: 'Не удалось изменить статус диалога.',
        });
      } else {
        await performMailReadMutation({
          mode: 'messages',
          targetId: String(selectedMessage?.id || ''),
          nextIsRead: !Boolean(selectedMessage?.is_read),
          currentUnreadCount: selectedMessage?.is_read ? 0 : 1,
          currentMessageCount: 1,
          errorMessage: 'Не удалось изменить статус письма.',
        });
      }
    } finally {
      setMessageActionLoading(false);
    }
  }, [performMailReadMutation, selectedConversation, selectedMessage, viewMode]);

  const handleArchiveSelectedMessage = useCallback(async () => {
    await runSelectedMessageMutation(
      (messageId) => mailAPI.moveMessage(messageId, withActiveMailboxPayload({ target_folder: 'archive' })),
      'Не удалось отправить письмо в архив.'
    );
  }, [mailAPI, runSelectedMessageMutation, withActiveMailboxPayload]);

  const handleRestoreSelectedMessage = useCallback(async () => {
    await runSelectedMessageMutation(
      (messageId) => mailAPI.restoreMessage(
        messageId,
        withActiveMailboxPayload({ target_folder: String(selectedMessage?.restore_hint_folder || 'inbox') })
      ),
      'Не удалось восстановить письмо.'
    );
  }, [mailAPI, runSelectedMessageMutation, selectedMessage?.restore_hint_folder, withActiveMailboxPayload]);

  const handleDeleteSelectedMessage = useCallback(async (permanent) => {
    await runSelectedMessageMutation(
      (messageId) => mailAPI.deleteMessage(messageId, withActiveMailboxPayload({ permanent: Boolean(permanent) })),
      'Не удалось удалить письмо.'
    );
  }, [mailAPI, runSelectedMessageMutation, withActiveMailboxPayload]);

  const handleMoveSelectedMessage = useCallback(async (targetOverride = '') => {
    const resolvedTarget = String(targetOverride || moveTarget || '');
    if (!resolvedTarget) return;
    await runSelectedMessageMutation(
      (messageId) => mailAPI.moveMessage(messageId, withActiveMailboxPayload({ target_folder: resolvedTarget })),
      'Не удалось переместить письмо.'
    );
  }, [mailAPI, moveTarget, runSelectedMessageMutation, withActiveMailboxPayload]);

  return {
    messageActionLoading,
    handleArchiveSelectedMessage,
    handleDeleteSelectedMessage,
    handleMoveSelectedMessage,
    handleRestoreSelectedMessage,
    handleToggleReadState,
  };
}

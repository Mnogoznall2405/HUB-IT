import { useCallback, useState } from 'react';
import { confirmMailPermanentDelete } from './mailPermanentDeleteConfirm';
import { extractTrashRestoreMessageId } from './mailTrashUndo';

export default function useMailSelectedPreviewActions({
  afterListMutation,
  clearSelection,
  confirmPermanentDelete = confirmMailPermanentDelete,
  folder = 'inbox',
  getMailErrorDetail,
  handleMailCredentialsRequired,
  invalidateMailClientCache,
  mailAPI,
  moveTarget = '',
  onRecoverableDelete,
  onRecoverableMove,
  getFolderLabel,
  performMailReadMutation,
  selectedConversation,
  selectedMessage,
  setError,
  setSelectedMessage,
  viewMode = 'messages',
  withActiveMailboxPayload,
} = {}) {
  const [messageActionLoading, setMessageActionLoading] = useState(false);

  const handleActionError = useCallback(async (requestError, fallbackMessage) => {
    if (await handleMailCredentialsRequired(requestError, fallbackMessage)) return;
    setError(getMailErrorDetail(requestError, fallbackMessage));
  }, [getMailErrorDetail, handleMailCredentialsRequired, setError]);

  const runSelectedMessageMutation = useCallback(async (operation, errorMessage) => {
    if (!selectedMessage?.id) return false;
    setMessageActionLoading(true);
    try {
      await operation(String(selectedMessage.id));
      clearSelection({ mode: viewMode });
      await afterListMutation();
      return true;
    } catch (requestError) {
      await handleActionError(requestError, errorMessage);
      return false;
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
          nextIsRead: !selectedMessage?.is_read,
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
    if (permanent && !confirmPermanentDelete({ count: 1 })) return;
    let restoreMessageId = '';
    const ok = await runSelectedMessageMutation(
      async (messageId) => {
        const result = await mailAPI.deleteMessage(messageId, withActiveMailboxPayload({ permanent: Boolean(permanent) }));
        restoreMessageId = extractTrashRestoreMessageId(result);
      },
      'Не удалось удалить письмо.'
    );
    if (ok && !permanent) {
      onRecoverableDelete?.({
        messageIds: restoreMessageId ? [restoreMessageId] : [],
        restoreFolder: folder,
        count: 1,
      });
    }
  }, [
    confirmPermanentDelete,
    folder,
    mailAPI,
    onRecoverableDelete,
    runSelectedMessageMutation,
    withActiveMailboxPayload,
  ]);

  const handleMoveSelectedMessage = useCallback(async (targetOverride = '') => {
    const resolvedTarget = String(targetOverride || moveTarget || '');
    if (!resolvedTarget) return;
    const messageId = String(selectedMessage?.id || '').trim();
    const ok = await runSelectedMessageMutation(
      (id) => mailAPI.moveMessage(id, withActiveMailboxPayload({ target_folder: resolvedTarget })),
      'Не удалось переместить письмо.'
    );
    if (ok && messageId) {
      onRecoverableMove?.({
        messageIds: [messageId],
        restoreFolder: folder,
        folderLabel: getFolderLabel?.(resolvedTarget) || resolvedTarget,
        count: 1,
      });
    }
  }, [
    folder,
    getFolderLabel,
    mailAPI,
    moveTarget,
    onRecoverableMove,
    runSelectedMessageMutation,
    selectedMessage?.id,
    withActiveMailboxPayload,
  ]);

  const handleToggleImportance = useCallback(async () => {
    if (!selectedMessage?.id || viewMode === 'conversations') return;
    const nextImportance = String(selectedMessage?.importance || 'normal').toLowerCase() === 'high'
      ? 'normal'
      : 'high';
    setMessageActionLoading(true);
    try {
      await mailAPI.setImportance(
        String(selectedMessage.id),
        withActiveMailboxPayload({ importance: nextImportance }),
      );
      setSelectedMessage?.((prev) => (prev ? { ...prev, importance: nextImportance } : prev));
      invalidateMailClientCache?.();
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, 'Не удалось изменить важность письма.');
    } finally {
      setMessageActionLoading(false);
    }
  }, [
    afterListMutation,
    handleActionError,
    invalidateMailClientCache,
    mailAPI,
    selectedMessage?.id,
    selectedMessage?.importance,
    setSelectedMessage,
    viewMode,
    withActiveMailboxPayload,
  ]);

  return {
    messageActionLoading,
    handleArchiveSelectedMessage,
    handleDeleteSelectedMessage,
    handleMoveSelectedMessage,
    handleRestoreSelectedMessage,
    handleToggleImportance,
    handleToggleReadState,
  };
}

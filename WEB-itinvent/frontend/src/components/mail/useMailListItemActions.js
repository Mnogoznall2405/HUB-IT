import { useCallback } from 'react';

const hasLoadedMessageBody = (detail) => Boolean(
  detail
  && !detail.__previewOnly
  && (
    String(detail?.body_html || '').trim()
    || String(detail?.body_text || '').trim()
  )
);

export default function useMailListItemActions({
  mailAPI,
  viewMode = 'messages',
  folder = 'inbox',
  selectedMessage,
  performMailReadMutation,
  afterListMutation,
  clearSelection,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  getRecentMessageDetailSnapshot,
  persistRecentMessageDetailSnapshot,
  resolveItemMailboxId,
  withActiveMailboxPayload,
  setError,
} = {}) {
  const handleActionError = useCallback(async (requestError, fallbackMessage) => {
    if (await handleMailCredentialsRequired(requestError, fallbackMessage)) return;
    setError(getMailErrorDetail(requestError, fallbackMessage));
  }, [getMailErrorDetail, handleMailCredentialsRequired, setError]);

  const clearIfSelected = useCallback((messageId) => {
    if (selectedMessage?.id && String(selectedMessage.id) === String(messageId)) {
      clearSelection({ mode: viewMode });
    }
  }, [clearSelection, selectedMessage?.id, viewMode]);

  const getMessageDetailForListAction = useCallback(async (item) => {
    const messageId = String(item?.id || '').trim();
    if (!messageId) return null;
    if (String(selectedMessage?.id || '') === messageId && hasLoadedMessageBody(selectedMessage)) {
      return selectedMessage;
    }
    const recentDetail = getRecentMessageDetailSnapshot(messageId);
    if (hasLoadedMessageBody(recentDetail)) {
      return recentDetail;
    }
    const data = await mailAPI.getMessage(messageId, {
      mailboxId: resolveItemMailboxId(item),
    });
    if (data) {
      persistRecentMessageDetailSnapshot(data);
    }
    return data || null;
  }, [
    getRecentMessageDetailSnapshot,
    mailAPI,
    persistRecentMessageDetailSnapshot,
    resolveItemMailboxId,
    selectedMessage,
  ]);

  const handleSwipeRead = useCallback(async (item) => {
    if (!item) return;
    if (viewMode === 'conversations') {
      await performMailReadMutation({
        mode: 'conversations',
        targetId: String(item?.conversation_id || item?.id || ''),
        nextIsRead: Number(item?.unread_count || 0) > 0,
        currentUnreadCount: Number(item?.unread_count || 0),
        currentMessageCount: Number(item?.messages_count || item?.items?.length || 1),
        errorMessage: 'Не удалось изменить статус диалога.',
      });
      return;
    }

    await performMailReadMutation({
      mode: 'messages',
      targetId: String(item?.id || ''),
      nextIsRead: !Boolean(item?.is_read),
      currentUnreadCount: item?.is_read ? 0 : 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось изменить статус письма.',
    });
  }, [performMailReadMutation, viewMode]);

  const handleSwipeDelete = useCallback(async (item, options = {}) => {
    if (!item?.id || viewMode !== 'messages') return;
    const permanent = typeof options?.permanent === 'boolean'
      ? options.permanent
      : folder === 'trash';
    try {
      await mailAPI.deleteMessage(item.id, withActiveMailboxPayload({ permanent }));
      clearIfSelected(item.id);
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, 'Не удалось удалить письмо.');
    }
  }, [
    afterListMutation,
    clearIfSelected,
    folder,
    handleActionError,
    mailAPI,
    viewMode,
    withActiveMailboxPayload,
  ]);

  const handleListRestoreMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      await mailAPI.restoreMessage(
        item.id,
        withActiveMailboxPayload({ target_folder: String(item?.restore_hint_folder || 'inbox') }),
      );
      clearIfSelected(item.id);
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, 'Не удалось восстановить письмо.');
    }
  }, [afterListMutation, clearIfSelected, handleActionError, mailAPI, viewMode, withActiveMailboxPayload]);

  const handleListArchiveMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      await mailAPI.moveMessage(item.id, withActiveMailboxPayload({ target_folder: 'archive' }));
      clearIfSelected(item.id);
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, 'Не удалось отправить письмо в архив.');
    }
  }, [afterListMutation, clearIfSelected, handleActionError, mailAPI, viewMode, withActiveMailboxPayload]);

  const handleListMoveMessage = useCallback(async (item, targetFolderId) => {
    const messageId = String(item?.id || '').trim();
    const targetFolder = String(targetFolderId || '').trim();
    if (!messageId || !targetFolder || viewMode !== 'messages') return;
    try {
      await mailAPI.moveMessage(messageId, withActiveMailboxPayload({ target_folder: targetFolder }));
      clearIfSelected(messageId);
      await afterListMutation();
    } catch (requestError) {
      await handleActionError(requestError, 'Не удалось переместить письмо.');
    }
  }, [afterListMutation, clearIfSelected, handleActionError, mailAPI, viewMode, withActiveMailboxPayload]);

  return {
    getMessageDetailForListAction,
    handleSwipeRead,
    handleSwipeDelete,
    handleListRestoreMessage,
    handleListArchiveMessage,
    handleListMoveMessage,
  };
}

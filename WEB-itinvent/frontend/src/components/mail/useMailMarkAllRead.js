import { useCallback } from 'react';

export default function useMailMarkAllRead({
  mailAPI,
  activeMailboxId,
  folder,
  folderScope,
  viewMode,
  selectedConversation,
  selectedMessage,
  applyConversationReadStateLocally,
  applyMessageReadStateLocally,
  afterListMutation,
  notifyMailSuccess,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  setError,
} = {}) {
  return useCallback(async () => {
    try {
      const data = await mailAPI.markAllRead({
        mailbox_id: activeMailboxId || undefined,
        folder,
        folder_scope: folderScope || 'current',
      });
      if (viewMode === 'conversations' && selectedConversation?.conversation_id) {
        applyConversationReadStateLocally({
          conversationId: String(selectedConversation.conversation_id),
          isRead: true,
          unreadCount: Number(selectedConversation?.unread_count || 0),
          messageCount: Number(selectedConversation?.messages_count || selectedConversation?.items?.length || 1),
          unreadDelta: -Math.max(0, Number(selectedConversation?.unread_count || 0)),
        });
      } else if (selectedMessage?.id && selectedMessage?.is_read === false) {
        applyMessageReadStateLocally({
          messageId: String(selectedMessage.id),
          isRead: true,
          unreadDelta: -1,
        });
      }
      await afterListMutation({ clearBulkSelection: false });
      notifyMailSuccess(`Отмечено как прочитанное: ${Number(data?.changed || 0)}.`);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отметить письма как прочитанные.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось отметить письма как прочитанные.'));
      }
    }
  }, [
    activeMailboxId,
    afterListMutation,
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    folder,
    folderScope,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailAPI,
    notifyMailSuccess,
    selectedConversation,
    selectedMessage,
    setError,
    viewMode,
  ]);
}

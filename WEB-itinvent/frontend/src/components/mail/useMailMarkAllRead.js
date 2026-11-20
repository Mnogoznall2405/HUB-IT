import { useCallback } from 'react';

export const MAIL_ALL_FOLDERS_SCOPE = 'all';

const collectVisibleUnreadTargets = ({ viewMode, listItems } = {}) => {
  const items = Array.isArray(listItems) ? listItems : [];
  if (viewMode === 'conversations') {
    return items
      .filter((item) => Number(item?.unread_count || 0) > 0)
      .map((item) => String(item?.conversation_id || item?.id || ''))
      .filter(Boolean);
  }
  return items
    .filter((item) => item?.is_read === false)
    .map((item) => String(item?.id || ''))
    .filter(Boolean);
};

export const confirmMailMarkAllReadScope = ({ folderScope = 'current' } = {}) => {
  if (String(folderScope || 'current') !== MAIL_ALL_FOLDERS_SCOPE) return true;
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }
  return Boolean(window.confirm('Отметить прочитанными все письма во всех папках ящика?'));
};

export default function useMailMarkAllRead({
  mailAPI,
  activeMailboxId,
  folder,
  folderScope,
  viewMode,
  listItems,
  hasNarrowingFilters = false,
  selectedConversation,
  selectedMessage,
  applyConversationReadStateLocally,
  applyMessageReadStateLocally,
  afterListMutation,
  notifyMailSuccess,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  setError,
  confirmAllScopeRead = confirmMailMarkAllReadScope,
} = {}) {
  return useCallback(async () => {
    const applySelectedReadState = () => {
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
    };

    try {
      if (hasNarrowingFilters) {
        // The backend mark-all endpoint ignores list filters, so under an
        // active search/filter only the loaded visible items may be touched.
        const unreadIds = collectVisibleUnreadTargets({ viewMode, listItems });
        if (unreadIds.length === 0) {
          notifyMailSuccess('Непрочитанных писем в текущей выборке нет.');
          return;
        }
        let changed = 0;
        let failedCount = 0;
        if (viewMode === 'conversations') {
          const results = await Promise.allSettled(unreadIds.map((conversationId) => (
            mailAPI.markConversationAsRead(conversationId, {
              mailbox_id: activeMailboxId || undefined,
              folder,
              folder_scope: folderScope || 'current',
            })
          )));
          changed = results.filter(
            (entry) => entry.status === 'fulfilled'
              && entry.value?.ok !== false
              && Number(entry.value?.failed || 0) === 0,
          ).length;
          failedCount = unreadIds.length - changed;
          if (changed === 0) {
            throw results[0]?.reason || new Error('mark-all-read failed');
          }
        } else {
          const data = await mailAPI.bulkMessageAction({
            mailbox_id: activeMailboxId || undefined,
            message_ids: unreadIds,
            action: 'mark_read',
          });
          changed = Number(data?.succeeded ?? data?.changed ?? 0);
          failedCount = Number(data?.failed || 0);
        }
        applySelectedReadState();
        await afterListMutation({ clearBulkSelection: false });
        if (failedCount > 0) {
          setError(`Не удалось отметить письма как прочитанные: ${failedCount}.`);
          if (changed === 0) return;
        }
        notifyMailSuccess(`Отмечено как прочитанное: ${changed}.`);
        return;
      }

      if (String(folderScope || 'current') === MAIL_ALL_FOLDERS_SCOPE
        && !confirmAllScopeRead({ folderScope })) {
        return;
      }
      const data = await mailAPI.markAllRead({
        mailbox_id: activeMailboxId || undefined,
        folder,
        folder_scope: folderScope || 'current',
      });
      const failedCount = Number(data?.failed || 0);
      applySelectedReadState();
      await afterListMutation({ clearBulkSelection: false });
      if (data?.ok === false || failedCount > 0) {
        setError(
          `Не удалось отметить часть писем как прочитанные: ${failedCount || 1}. `
          + 'Повторите действие позже.',
        );
        if (Number(data?.changed || 0) <= 0) return;
      }
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
    confirmAllScopeRead,
    folder,
    folderScope,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    hasNarrowingFilters,
    listItems,
    mailAPI,
    notifyMailSuccess,
    selectedConversation,
    selectedMessage,
    setError,
    viewMode,
  ]);
}

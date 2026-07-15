import { useCallback } from 'react';
import {
  buildMailReadMutationPlan,
  clearLocalReadStateOverride,
  getConversationReadUnreadCount,
  setLocalReadStateOverride,
} from './mailReadStateModel';

export default function useMailReadMutations({
  activeMailboxId,
  advancedFiltersApplied,
  folder,
  getMailErrorDetail,
  getRecentMessageDetailSnapshot,
  handleMailCredentialsRequired,
  invalidateMailClientCache,
  mailAPI,
  persistRecentMessageDetailSnapshot,
  readStateOverrideTtlMs,
  refreshFolderSummary,
  refreshList,
  refs = {},
  setError,
  setFolderSummary,
  setListData,
  setSelectedConversation,
  setSelectedMessage,
  settleAutoReadGuard,
  unreadOnly,
  withActiveMailboxPayload,
} = {}) {
  const {
    listDataRef,
    selectedMessageRef,
    selectedConversationRef,
    localReadStateOverridesRef,
    folderSummaryRef,
  } = refs;

  const emitMailUnreadChange = useCallback((detail = {}) => {
    window.dispatchEvent(new CustomEvent('mail-read', { detail }));
  }, []);

  const updateCurrentFolderUnread = useCallback((delta) => {
    if (!delta) return true;
    const currentSummary = folderSummaryRef?.current;
    const current = currentSummary?.[folder];
    if (!current) return false;
    const nextSummary = {
      ...(currentSummary || {}),
      [folder]: {
        ...(current || {}),
        unread: Math.max(0, Number(current?.unread || 0) + Number(delta || 0)),
      },
    };
    folderSummaryRef.current = nextSummary;
    setFolderSummary(nextSummary);
    return true;
  }, [folder, folderSummaryRef, setFolderSummary]);

  const applyMessageReadStateLocally = useCallback(({ messageId, isRead, unreadDelta = 0 }) => {
    const normalizedMessageId = String(messageId || '');
    if (!normalizedMessageId) return false;
    const applyToList = (source) => ({
      ...(source || {}),
      items: (Array.isArray(source?.items) ? source.items : []).map((item) => (
        String(item?.id || '') === normalizedMessageId ? { ...item, is_read: Boolean(isRead) } : item
      )),
    });
    listDataRef.current = applyToList(listDataRef.current);
    setListData((prev) => applyToList(prev));
    setSelectedMessage((prev) => {
      if (String(prev?.id || '') !== normalizedMessageId) return prev;
      const nextMessage = { ...(prev || {}), is_read: Boolean(isRead) };
      selectedMessageRef.current = nextMessage;
      return nextMessage;
    });
    if (String(selectedMessageRef.current?.id || '') === normalizedMessageId) {
      selectedMessageRef.current = {
        ...(selectedMessageRef.current || {}),
        is_read: Boolean(isRead),
      };
    }
    const recentDetail = getRecentMessageDetailSnapshot(normalizedMessageId);
    if (recentDetail) {
      persistRecentMessageDetailSnapshot({
        ...recentDetail,
        is_read: Boolean(isRead),
      });
    }
    return updateCurrentFolderUnread(unreadDelta);
  }, [
    getRecentMessageDetailSnapshot,
    listDataRef,
    persistRecentMessageDetailSnapshot,
    selectedMessageRef,
    setListData,
    setSelectedMessage,
    updateCurrentFolderUnread,
  ]);

  const applyConversationReadStateLocally = useCallback(({
    conversationId,
    isRead,
    unreadCount = 0,
    messageCount = 0,
    unreadDelta = 0,
  }) => {
    const normalizedConversationId = String(conversationId || '');
    if (!normalizedConversationId) return false;
    const finalUnreadCount = getConversationReadUnreadCount({
      isRead,
      unreadCount,
      messageCount,
    });
    const applyToList = (source) => ({
      ...(source || {}),
      items: (Array.isArray(source?.items) ? source.items : []).map((item) => (
        String(item?.conversation_id || item?.id || '') === normalizedConversationId
          ? { ...item, unread_count: finalUnreadCount }
          : item
      )),
    });
    listDataRef.current = applyToList(listDataRef.current);
    setListData((prev) => applyToList(prev));
    setSelectedConversation((prev) => {
      if (String(prev?.conversation_id || '') !== normalizedConversationId) return prev;
      const nextConversation = {
        ...(prev || {}),
        unread_count: finalUnreadCount,
        items: (Array.isArray(prev?.items) ? prev.items : []).map((item) => ({
          ...item,
          is_read: Boolean(isRead),
        })),
      };
      selectedConversationRef.current = nextConversation;
      return nextConversation;
    });
    if (String(selectedConversationRef.current?.conversation_id || '') === normalizedConversationId) {
      selectedConversationRef.current = {
        ...(selectedConversationRef.current || {}),
        unread_count: finalUnreadCount,
        items: (Array.isArray(selectedConversationRef.current?.items) ? selectedConversationRef.current.items : []).map((item) => ({
          ...item,
          is_read: Boolean(isRead),
        })),
      };
    }
    setSelectedMessage((prev) => {
      if (!prev) return prev;
      if (String(prev?.conversation_id || '') !== normalizedConversationId) return prev;
      const nextMessage = { ...(prev || {}), is_read: Boolean(isRead) };
      selectedMessageRef.current = nextMessage;
      return nextMessage;
    });
    if (String(selectedMessageRef.current?.conversation_id || '') === normalizedConversationId) {
      selectedMessageRef.current = {
        ...(selectedMessageRef.current || {}),
        is_read: Boolean(isRead),
      };
    }
    return updateCurrentFolderUnread(unreadDelta);
  }, [
    listDataRef,
    selectedConversationRef,
    selectedMessageRef,
    setListData,
    setSelectedConversation,
    setSelectedMessage,
    updateCurrentFolderUnread,
  ]);

  const performMailReadMutation = useCallback(async ({
    mode,
    targetId,
    nextIsRead,
    currentUnreadCount = 0,
    currentMessageCount = 1,
    errorMessage = 'Не удалось изменить статус письма.',
    autoReadGuardKey = '',
  }) => {
    const mutationPlan = buildMailReadMutationPlan({
      mode,
      targetId,
      nextIsRead,
      currentUnreadCount,
      currentMessageCount,
    });
    if (!mutationPlan) return false;
    const {
      normalizedMode,
      normalizedTargetId,
      normalizedUnreadCount,
      normalizedMessageCount,
      unreadDelta,
    } = mutationPlan;

    localReadStateOverridesRef.current = setLocalReadStateOverride({
      mode: normalizedMode,
      targetId: normalizedTargetId,
      isRead: nextIsRead,
      overrides: localReadStateOverridesRef.current,
      now: Date.now(),
      ttlMs: readStateOverrideTtlMs,
    });
    const folderUnreadApplied = normalizedMode === 'conversations'
      ? applyConversationReadStateLocally({
        conversationId: normalizedTargetId,
        isRead: nextIsRead,
        unreadCount: normalizedUnreadCount,
        messageCount: normalizedMessageCount,
        unreadDelta,
      })
      : applyMessageReadStateLocally({
        messageId: normalizedTargetId,
        isRead: nextIsRead,
        unreadDelta,
      });
    emitMailUnreadChange({
      phase: 'optimistic',
      mode: normalizedMode,
      targetId: normalizedTargetId,
      mailboxId: activeMailboxId || '',
      folder,
      unreadDelta,
      nextIsRead: Boolean(nextIsRead),
    });

    let mutationSucceeded = false;
    try {
      if (normalizedMode === 'conversations') {
        const payload = withActiveMailboxPayload({
          folder,
          folder_scope: advancedFiltersApplied?.folder_scope || 'current',
        });
        if (nextIsRead) {
          await mailAPI.markConversationAsRead(normalizedTargetId, payload);
        } else {
          await mailAPI.markConversationAsUnread(normalizedTargetId, payload);
        }
      } else if (nextIsRead) {
        if (activeMailboxId) await mailAPI.markAsRead(normalizedTargetId, activeMailboxId);
        else await mailAPI.markAsRead(normalizedTargetId);
      } else {
        if (activeMailboxId) await mailAPI.markAsUnread(normalizedTargetId, activeMailboxId);
        else await mailAPI.markAsUnread(normalizedTargetId);
      }

      if (!folderUnreadApplied) {
        updateCurrentFolderUnread(unreadDelta);
      }
      invalidateMailClientCache(['bootstrap', 'list', 'notification-feed']);
      emitMailUnreadChange({
        phase: 'confirmed',
        mode: normalizedMode,
        targetId: normalizedTargetId,
        mailboxId: activeMailboxId || '',
        folder,
        unreadDelta: 0,
        nextIsRead: Boolean(nextIsRead),
      });
      const refreshTasks = [];
      if (unreadOnly) {
        refreshTasks.unshift(
          refreshList({
            silent: true,
            selectFirstIfSelectionMissing: Boolean(nextIsRead && unreadOnly),
            force: true,
          })
        );
      }
      if (refreshTasks.length > 0) {
        await Promise.all(refreshTasks);
      }
      mutationSucceeded = true;
      return true;
    } catch (requestError) {
      emitMailUnreadChange({
        phase: 'rollback',
        mode: normalizedMode,
        targetId: normalizedTargetId,
        mailboxId: activeMailboxId || '',
        folder,
        unreadDelta: -unreadDelta,
        nextIsRead: !Boolean(nextIsRead),
      });
      localReadStateOverridesRef.current = clearLocalReadStateOverride({
        mode: normalizedMode,
        targetId: normalizedTargetId,
        overrides: localReadStateOverridesRef.current,
      });
      await Promise.allSettled([
        refreshList({ silent: true, force: true }),
        refreshFolderSummary({ force: true }),
      ]);
      if (await handleMailCredentialsRequired(requestError, errorMessage)) {
        return false;
      }
      setError(getMailErrorDetail(requestError, errorMessage));
      return false;
    } finally {
      settleAutoReadGuard(autoReadGuardKey, mutationSucceeded);
    }
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    emitMailUnreadChange,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    localReadStateOverridesRef,
    mailAPI,
    readStateOverrideTtlMs,
    refreshFolderSummary,
    refreshList,
    settleAutoReadGuard,
    updateCurrentFolderUnread,
    unreadOnly,
    withActiveMailboxPayload,
    setError,
  ]);

  return {
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    performMailReadMutation,
  };
}

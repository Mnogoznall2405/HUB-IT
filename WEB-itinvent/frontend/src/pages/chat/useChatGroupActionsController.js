import { useCallback } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatGroupActionsController({
  activeConversationIdRef,
  clearStoredConversationState,
  closeAllPanels,
  closeInfoAndContextPanels,
  isMobile,
  notifyApiError,
  openMobileInboxView,
  setActiveConversationId,
  setConversationDetailsById,
  setConversations,
  setMessages,
  setMessagesHasMore,
  setMessagesHasNewer,
  setViewerLastReadAt,
  setViewerLastReadMessageId,
  upsertConversationDetail,
  upsertSearchConversation,
}) {
  const applyGroupConversationUpdate = useCallback((updated) => {
    const normalizedConversationId = String(updated?.id || '').trim();
    if (!normalizedConversationId) return updated;
    setConversations((current) => {
      const exists = current.some((item) => String(item?.id || '').trim() === normalizedConversationId);
      const next = exists
        ? current.map((item) => (String(item?.id || '').trim() === normalizedConversationId ? { ...item, ...updated } : item))
        : [{ ...updated }, ...current];
      return next;
    });
    upsertConversationDetail(updated);
    upsertSearchConversation(updated);
    return updated;
  }, [setConversations, upsertConversationDetail, upsertSearchConversation]);

  const handleAddGroupMembers = useCallback(async (memberUserIds) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.addGroupMembers(conversationId, memberUserIds);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось добавить участников.');
      throw error;
    }
  }, [activeConversationIdRef, applyGroupConversationUpdate, notifyApiError]);

  const handleRemoveGroupMember = useCallback(async (memberUserId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.removeGroupMember(conversationId, memberUserId);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось исключить участника.');
      throw error;
    }
  }, [activeConversationIdRef, applyGroupConversationUpdate, notifyApiError]);

  const handleUpdateGroupMemberRole = useCallback(async (memberUserId, memberRole) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.updateGroupMemberRole(conversationId, memberUserId, memberRole);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить роль участника.');
      throw error;
    }
  }, [activeConversationIdRef, applyGroupConversationUpdate, notifyApiError]);

  const handleTransferGroupOwnership = useCallback(async (ownerUserId) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.transferGroupOwnership(conversationId, ownerUserId);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось передать владельца группы.');
      throw error;
    }
  }, [activeConversationIdRef, applyGroupConversationUpdate, notifyApiError]);

  const handleUpdateGroupProfile = useCallback(async (payload) => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const updated = await chatAPI.updateGroupProfile(conversationId, payload);
      return applyGroupConversationUpdate(updated);
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить группу.');
      throw error;
    }
  }, [activeConversationIdRef, applyGroupConversationUpdate, notifyApiError]);

  const handleLeaveGroup = useCallback(async () => {
    const conversationId = String(activeConversationIdRef.current || '').trim();
    if (!conversationId) return null;
    try {
      const payload = await chatAPI.leaveGroup(conversationId);
      setConversations((current) => current.filter((item) => String(item?.id || '').trim() !== conversationId));
      setConversationDetailsById((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      clearStoredConversationState({ conversationId, invalidateThread: true });
      closeInfoAndContextPanels();
      setActiveConversationId('');
      if (isMobile) openMobileInboxView();
      return payload;
    } catch (error) {
      notifyApiError(error, 'Не удалось выйти из группы.');
      throw error;
    }
  }, [
    activeConversationIdRef,
    clearStoredConversationState,
    closeInfoAndContextPanels,
    isMobile,
    notifyApiError,
    openMobileInboxView,
    setActiveConversationId,
    setConversationDetailsById,
    setConversations,
  ]);

  const handleRemoteConversationRemoved = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    setConversations((current) => current.filter((item) => String(item?.id || '').trim() !== normalizedConversationId));
    setConversationDetailsById((current) => {
      const next = { ...current };
      delete next[normalizedConversationId];
      return next;
    });
    if (String(activeConversationIdRef.current || '').trim() === normalizedConversationId) {
      clearStoredConversationState({ conversationId: normalizedConversationId, invalidateThread: true });
      closeAllPanels();
      setActiveConversationId('');
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesHasNewer(false);
      setViewerLastReadMessageId('');
      setViewerLastReadAt('');
      if (isMobile) openMobileInboxView();
    }
  }, [
    activeConversationIdRef,
    clearStoredConversationState,
    closeAllPanels,
    isMobile,
    openMobileInboxView,
    setActiveConversationId,
    setConversationDetailsById,
    setConversations,
    setMessages,
    setMessagesHasMore,
    setMessagesHasNewer,
    setViewerLastReadAt,
    setViewerLastReadMessageId,
  ]);

  return {
    applyGroupConversationUpdate,
    handleAddGroupMembers,
    handleLeaveGroup,
    handleRemoteConversationRemoved,
    handleRemoveGroupMember,
    handleTransferGroupOwnership,
    handleUpdateGroupMemberRole,
    handleUpdateGroupProfile,
  };
}

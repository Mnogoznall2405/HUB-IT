import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import { resolveDirectConversationId } from '../../components/chat/chatHelpers';

export default function useChatNavigationController({
  activeConversationIdRef,
  conversationsRef,
  focusComposer,
  handleActiveFolderChange,
  isMobile,
  logChatDebug,
  notifyApiError,
  openMobileThreadView,
  prefetchAdjacentThreadBootstraps,
  prefetchThreadBootstrap,
  resetMessageSearch,
  resetSidebarSearch,
  searchChats = [],
  setActiveConversationId,
  setAiBots,
  setAiStatusByConversation,
  setInfoOpen,
  setOpeningAiBotId,
  setOpeningPeerId,
  upsertConversation,
}) {
  const openConversation = useCallback((conversationId) => {
    const normalizedConversationId = String(conversationId || '').trim();
    logChatDebug('openConversation', {
      conversationId: normalizedConversationId,
    });
    void prefetchThreadBootstrap(normalizedConversationId);
    if (normalizedConversationId && normalizedConversationId === String(activeConversationIdRef.current || '').trim()) {
      void prefetchThreadBootstrap(normalizedConversationId, { force: true });
    }
    setInfoOpen(false);
    setActiveConversationId(normalizedConversationId);
    resetMessageSearch();
    if (isMobile) {
      openMobileThreadView(normalizedConversationId);
      resetSidebarSearch();
    }
    if (normalizedConversationId) {
      prefetchAdjacentThreadBootstraps?.(normalizedConversationId);
    }
  }, [
    activeConversationIdRef,
    isMobile,
    logChatDebug,
    openMobileThreadView,
    prefetchAdjacentThreadBootstraps,
    prefetchThreadBootstrap,
    resetMessageSearch,
    resetSidebarSearch,
    setActiveConversationId,
    setInfoOpen,
  ]);

  const handleOpenArchiveFolder = useCallback(() => {
    handleActiveFolderChange('archived');
  }, [handleActiveFolderChange]);

  const handleOpenPeer = useCallback(async (peer) => {
    const peerId = Number(peer?.id || 0);
    if (!Number.isFinite(peerId) || peerId <= 0) return;

    const existingConversationId = resolveDirectConversationId(peerId, {
      conversations: conversationsRef?.current,
      searchChats,
    });
    if (existingConversationId) {
      resetSidebarSearch();
      openConversation(existingConversationId);
      focusComposer();
      return;
    }

    setOpeningPeerId(String(peerId));
    try {
      const created = await chatAPI.createDirectConversation(peerId);
      resetSidebarSearch();
      const createdId = String(created?.id || '').trim();
      if (!createdId) {
        throw new Error('Direct conversation id is missing');
      }
      upsertConversation(created, { promote: true });
      await prefetchThreadBootstrap(createdId, { force: true });
      openConversation(createdId);
      focusComposer();
    } catch (error) {
      notifyApiError(error, 'Не удалось открыть личный диалог.');
    } finally {
      setOpeningPeerId('');
    }
  }, [
    conversationsRef,
    focusComposer,
    notifyApiError,
    openConversation,
    prefetchThreadBootstrap,
    resetSidebarSearch,
    searchChats,
    setOpeningPeerId,
    upsertConversation,
  ]);

  const handleOpenAiBot = useCallback(async (bot) => {
    const botId = String(bot?.id || '').trim();
    if (!botId) return;
    const existingConversationId = String(bot?.conversation_id || '').trim();
    if (existingConversationId) {
      openConversation(existingConversationId);
      focusComposer();
      return;
    }
    setOpeningAiBotId(botId);
    try {
      const conversation = await chatAPI.openAiBotConversation(botId);
      if (conversation?.id) {
        const normalizedConversationId = String(conversation.id).trim();
        upsertConversation(conversation, { promote: true });
        setAiBots((current) => current.map((item) => (
          String(item?.id || '').trim() === botId
            ? { ...item, conversation_id: normalizedConversationId }
            : item
        )));
        setAiStatusByConversation((current) => ({
          ...current,
          [normalizedConversationId]: {
            conversation_id: normalizedConversationId,
            bot_id: botId,
            bot_title: String(bot?.title || '').trim(),
            status: null,
            run_id: null,
            error_text: null,
            updated_at: null,
          },
        }));
        openConversation(normalizedConversationId);
        focusComposer();
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось открыть AI-чат.');
    } finally {
      setOpeningAiBotId('');
    }
  }, [
    focusComposer,
    notifyApiError,
    openConversation,
    setAiBots,
    setAiStatusByConversation,
    setOpeningAiBotId,
    upsertConversation,
  ]);

  return {
    handleOpenAiBot,
    handleOpenArchiveFolder,
    handleOpenPeer,
    openConversation,
  };
}

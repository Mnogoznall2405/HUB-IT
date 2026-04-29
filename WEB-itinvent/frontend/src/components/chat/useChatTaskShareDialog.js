import { useCallback, useEffect, useState } from 'react';

import { chatAPI } from '../../api/client';

const DEFAULT_SEARCH_DEBOUNCE_MS = 250;

export default function useChatTaskShareDialog({
  activeConversationId,
  loadChatDialogsModule,
  notifyApiError,
  searchDebounceMs = DEFAULT_SEARCH_DEBOUNCE_MS,
  setComposerMenuAnchor,
  setMessageMenuAnchor,
  setMessageMenuMessage,
  setThreadMenuAnchor,
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [shareableTasks, setShareableTasks] = useState([]);
  const [shareableLoading, setShareableLoading] = useState(false);
  const [sharingTaskId, setSharingTaskId] = useState('');

  const resetShareDialog = useCallback(() => {
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setShareOpen(false);
    setTaskSearch('');
    setShareableTasks([]);
    setSharingTaskId('');
  }, [setMessageMenuAnchor, setMessageMenuMessage, setThreadMenuAnchor]);

  const loadShareableTasks = useCallback(async (conversationId, query = '') => {
    const id = String(conversationId || '').trim();
    if (!id) {
      setShareableTasks([]);
      return;
    }
    setShareableLoading(true);
    try {
      const data = await chatAPI.getShareableTasks(id, { q: query, limit: 50 });
      setShareableTasks(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить задачи, доступные для отправки в этот чат.');
      setShareableTasks([]);
    } finally {
      setShareableLoading(false);
    }
  }, [notifyApiError]);

  useEffect(() => {
    if (!shareOpen || !activeConversationId) return undefined;
    const timeoutId = window.setTimeout(() => {
      void loadShareableTasks(activeConversationId, taskSearch);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [activeConversationId, loadShareableTasks, searchDebounceMs, shareOpen, taskSearch]);

  const openShareDialog = useCallback(() => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(null);
    setMessageMenuAnchor(null);
    setMessageMenuMessage(null);
    setComposerMenuAnchor(null);
    setShareOpen(true);
  }, [
    loadChatDialogsModule,
    setComposerMenuAnchor,
    setMessageMenuAnchor,
    setMessageMenuMessage,
    setThreadMenuAnchor,
  ]);

  return {
    openShareDialog,
    resetShareDialog,
    setSharingTaskId,
    setTaskSearch,
    shareOpen,
    shareableLoading,
    shareableTasks,
    sharingTaskId,
    taskSearch,
  };
}

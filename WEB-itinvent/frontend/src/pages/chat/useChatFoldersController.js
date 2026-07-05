import { useCallback } from 'react';

import chatFoldersAPI from '../../api/chatFolders';
import {
  buildConversationIdsByFolder,
  readStoredActiveFolderKey,
  writeStoredActiveFolderKey,
} from '../../components/chat/chatFolderUtils';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';

export default function useChatFoldersController({
  notifyApiError,
  setCustomFolders,
  setConversationIdsByFolder,
  setFoldersLoading,
  setConversationFilter,
}) {
  const applyFoldersPayload = useCallback((payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const idsByFolder = buildConversationIdsByFolder(items, payload?.conversation_ids_by_folder || {});
    setCustomFolders(items);
    setConversationIdsByFolder(idsByFolder);
    return items;
  }, [setConversationIdsByFolder, setCustomFolders]);

  const loadChatFolders = useCallback(async ({ silent = false } = {}) => {
    if (!CHAT_FEATURE_ENABLED) return [];
    if (!silent) setFoldersLoading(true);
    try {
      const payload = await chatFoldersAPI.listFolders();
      return applyFoldersPayload(payload);
    } catch (error) {
      if (!silent) notifyApiError(error, 'Не удалось загрузить папки чатов.');
      return [];
    } finally {
      if (!silent) setFoldersLoading(false);
    }
  }, [applyFoldersPayload, notifyApiError, setFoldersLoading]);

  const handleActiveFolderChange = useCallback((nextFolderKey) => {
    const normalized = String(nextFolderKey || 'all').trim() || 'all';
    setConversationFilter(normalized);
    writeStoredActiveFolderKey(normalized);
  }, [setConversationFilter]);

  const restoreFolderFilter = useCallback(() => {
    setConversationFilter(readStoredActiveFolderKey());
  }, [setConversationFilter]);

  return {
    applyFoldersPayload,
    handleActiveFolderChange,
    loadChatFolders,
    restoreFolderFilter,
  };
}

import { useCallback } from 'react';

import chatFoldersAPI from '../../api/chatFolders';

export default function useChatFolderMutationsController({
  conversationFilter,
  customFolders,
  handleActiveFolderChange,
  loadChatFolders,
  notifyApiError,
  setFolderManagerCreateMode,
  setFolderManagerOpen,
  setFolderSaving,
}) {
  const handleOpenFolderManager = useCallback((options = {}) => {
    setFolderManagerCreateMode(Boolean(options?.create));
    setFolderManagerOpen(true);
  }, [setFolderManagerCreateMode, setFolderManagerOpen]);

  const handleCreateChatFolder = useCallback(async (name) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.createFolder(name);
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать папку.');
      throw error;
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError, setFolderSaving]);

  const handleRenameChatFolder = useCallback(async (folderId, name) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.updateFolder(folderId, { name });
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось переименовать папку.');
      throw error;
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError, setFolderSaving]);

  const handleDeleteChatFolder = useCallback(async (folderId) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.deleteFolder(folderId);
      if (String(conversationFilter) === String(folderId)) {
        handleActiveFolderChange('all');
      }
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось удалить папку.');
    } finally {
      setFolderSaving(false);
    }
  }, [conversationFilter, handleActiveFolderChange, loadChatFolders, notifyApiError, setFolderSaving]);

  const handleReorderChatFolder = useCallback(async (folderId, direction) => {
    const items = [...customFolders];
    const index = items.findIndex((item) => String(item?.id || '') === String(folderId));
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setFolderSaving(true);
    try {
      await Promise.all(next.map((folder, sortOrder) => (
        chatFoldersAPI.updateFolder(folder.id, { sort_order: sortOrder })
      )));
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось изменить порядок папок.');
    } finally {
      setFolderSaving(false);
    }
  }, [customFolders, loadChatFolders, notifyApiError, setFolderSaving]);

  const handleRemoveConversationFromFolder = useCallback(async (folderId, conversationId) => {
    setFolderSaving(true);
    try {
      await chatFoldersAPI.removeFolderConversation(folderId, conversationId);
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось убрать чат из папки.');
    } finally {
      setFolderSaving(false);
    }
  }, [loadChatFolders, notifyApiError, setFolderSaving]);

  const handleToggleConversationInFolder = useCallback(async (folderId, conversationId, nextIncluded) => {
    const normalizedFolderId = String(folderId || '').trim();
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedFolderId || !normalizedConversationId) return;
    try {
      if (nextIncluded) {
        await chatFoldersAPI.addFolderConversation(normalizedFolderId, normalizedConversationId);
      } else {
        await chatFoldersAPI.removeFolderConversation(normalizedFolderId, normalizedConversationId);
      }
      await loadChatFolders({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось обновить папку чата.');
    }
  }, [loadChatFolders, notifyApiError]);

  return {
    handleCreateChatFolder,
    handleDeleteChatFolder,
    handleOpenFolderManager,
    handleRemoveConversationFromFolder,
    handleRenameChatFolder,
    handleReorderChatFolder,
    handleToggleConversationInFolder,
  };
}

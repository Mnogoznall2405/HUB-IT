import { useCallback, useState } from 'react';

export default function useMailFolderMutations({
  mailAPI,
  activeMailboxId = '',
  folder = 'inbox',
  folderTree = [],
  setFolder,
  clearSelection,
  invalidateMailClientCache,
  refreshFolderTree,
  handleMailCredentialsRequired,
  getMailErrorDetail,
  onError,
  onMessage,
} = {}) {
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState('create');
  const [folderDialogParentId, setFolderDialogParentId] = useState('');
  const [folderDialogScope, setFolderDialogScope] = useState('mailbox');
  const [folderDialogTarget, setFolderDialogTarget] = useState(null);
  const [folderDialogName, setFolderDialogName] = useState('');
  const [folderDialogSaving, setFolderDialogSaving] = useState(false);

  const closeFolderDialog = useCallback(() => {
    setFolderDialogOpen(false);
  }, []);

  const handleOpenCreateFolderDialog = useCallback((target) => {
    const token = String(target || 'mailbox');
    const isScopeOnly = token === 'mailbox' || token === 'archive';
    setFolderDialogMode('create');
    setFolderDialogParentId(isScopeOnly ? '' : token);
    setFolderDialogScope(isScopeOnly ? token : 'mailbox');
    setFolderDialogTarget(isScopeOnly ? null : (
      Array.isArray(folderTree)
        ? folderTree.find((item) => String(item?.id || '') === token) || null
        : null
    ));
    setFolderDialogName('');
    setFolderDialogOpen(true);
  }, [folderTree]);

  const handleOpenRenameFolderDialog = useCallback((item) => {
    if (!item) return;
    setFolderDialogMode('rename');
    setFolderDialogParentId(String(item.id || ''));
    setFolderDialogScope(String(item.scope || 'mailbox'));
    setFolderDialogTarget(item);
    setFolderDialogName(String(item.label || item.name || ''));
    setFolderDialogOpen(true);
  }, []);

  const handleSubmitFolderDialog = useCallback(async () => {
    const name = String(folderDialogName || '').trim();
    if (!name) {
      onError?.('Укажите название папки.');
      return;
    }
    setFolderDialogSaving(true);
    try {
      if (folderDialogMode === 'rename' && folderDialogTarget?.id) {
        await mailAPI?.renameFolder?.(folderDialogTarget.id, { name, mailbox_id: activeMailboxId || undefined });
        onMessage?.('Папка переименована.');
      } else {
        await mailAPI?.createFolder?.({
          mailbox_id: activeMailboxId || undefined,
          name,
          parent_folder_id: folderDialogParentId || '',
          scope: folderDialogScope || 'mailbox',
        });
        onMessage?.('Папка создана.');
      }
      setFolderDialogOpen(false);
      invalidateMailClientCache?.(['bootstrap', 'folder-tree']);
      await refreshFolderTree?.({ force: true });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось сохранить папку.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось сохранить папку.')
          : (requestError?.response?.data?.detail || 'Не удалось сохранить папку.');
        onError?.(detail);
      }
    } finally {
      setFolderDialogSaving(false);
    }
  }, [
    activeMailboxId,
    folderDialogMode,
    folderDialogTarget,
    folderDialogName,
    folderDialogParentId,
    folderDialogScope,
    folderDialogTarget?.id,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    onError,
    onMessage,
    refreshFolderTree,
  ]);

  const handleDeleteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    if (!window.confirm(`Удалить папку "${item.label || item.name || 'без названия'}"?`)) return;
    try {
      await mailAPI?.deleteFolder?.(item.id, activeMailboxId);
      if (String(folder) === String(item.id)) {
        clearSelection?.({ allModes: true });
        setFolder?.('inbox');
      }
      invalidateMailClientCache?.(['bootstrap', 'folder-tree']);
      await refreshFolderTree?.({ force: true });
      onMessage?.('Папка удалена.');
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось удалить папку.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось удалить папку.')
          : (requestError?.response?.data?.detail || 'Не удалось удалить папку.');
        onError?.(detail);
      }
    }
  }, [
    activeMailboxId,
    clearSelection,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    onError,
    onMessage,
    refreshFolderTree,
    setFolder,
  ]);

  const handleToggleFavoriteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    try {
      await mailAPI?.setFolderFavorite?.(item.id, !Boolean(item?.is_favorite), activeMailboxId);
      invalidateMailClientCache?.(['bootstrap', 'folder-tree']);
      await refreshFolderTree?.({ force: true });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired?.(requestError, 'Не удалось обновить избранные папки.'))) {
        const detail = getMailErrorDetail
          ? getMailErrorDetail(requestError, 'Не удалось обновить избранные папки.')
          : (requestError?.response?.data?.detail || 'Не удалось обновить избранные папки.');
        onError?.(detail);
      }
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    onError,
    refreshFolderTree,
  ]);

  return {
    folderDialogOpen,
    closeFolderDialog,
    folderDialogMode,
    folderDialogName,
    setFolderDialogName,
    folderDialogSaving,
    handleOpenCreateFolderDialog,
    handleOpenRenameFolderDialog,
    handleSubmitFolderDialog,
    handleDeleteFolder,
    handleToggleFavoriteFolder,
  };
}

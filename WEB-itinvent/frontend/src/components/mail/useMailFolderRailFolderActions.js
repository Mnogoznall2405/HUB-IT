import { useCallback } from 'react';

export default function useMailFolderRailFolderActions({
  closeMobileNavigationIfNeeded,
  handleOpenCreateFolderDialog,
  handleOpenRenameFolderDialog,
  handleDeleteFolder,
  handleToggleFavoriteFolder,
} = {}) {
  const handleCreateFolderRequest = useCallback((target) => {
    closeMobileNavigationIfNeeded();
    handleOpenCreateFolderDialog(target);
  }, [closeMobileNavigationIfNeeded, handleOpenCreateFolderDialog]);

  const handleRenameFolderRequest = useCallback((item) => {
    closeMobileNavigationIfNeeded();
    handleOpenRenameFolderDialog(item);
  }, [closeMobileNavigationIfNeeded, handleOpenRenameFolderDialog]);

  const handleDeleteFolderRequest = useCallback(async (item) => {
    closeMobileNavigationIfNeeded();
    await handleDeleteFolder(item);
  }, [closeMobileNavigationIfNeeded, handleDeleteFolder]);

  const handleToggleFavoriteFolderFromRail = useCallback(async (item) => {
    closeMobileNavigationIfNeeded();
    await handleToggleFavoriteFolder(item);
  }, [closeMobileNavigationIfNeeded, handleToggleFavoriteFolder]);

  return {
    handleCreateFolderRequest,
    handleRenameFolderRequest,
    handleDeleteFolderRequest,
    handleToggleFavoriteFolderFromRail,
  };
}

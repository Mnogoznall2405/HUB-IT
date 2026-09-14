import { useCallback, useState } from 'react';

import { myFilesAPI } from '../../api/myFiles';

const EMPTY_FOLDER_SHARE = { open: false, folderId: '', url: '', folderName: '', linkCopied: false };
const EMPTY_FILE_SHARE = { open: false, fileId: '', url: '', expiresAt: null, fileName: '', linkCopied: false };

export function useMyFilesShares({ loadData, notifySuccess, notifyWarning, notifyApiError }) {
  const [folderShareDialog, setFolderShareDialog] = useState(EMPTY_FOLDER_SHARE);
  const [shareDialog, setShareDialog] = useState(EMPTY_FILE_SHARE);

  const shareFile = useCallback(async (item, { rotate = false } = {}) => {
    try {
      const payload = await myFilesAPI.createShare(item.id, { rotate });
      const publicUrl = myFilesAPI.buildPublicUrl(payload.token);
      let linkCopied = false;
      try {
        await navigator.clipboard?.writeText(publicUrl);
        linkCopied = true;
      } catch {
        notifyWarning('Ссылка создана. Скопируйте её из окна.', { source: 'my-files-share', dedupeMode: 'none' });
      }
      setShareDialog({
        open: true,
        fileId: item.id,
        url: publicUrl,
        expiresAt: payload.expires_at || item.expires_at,
        fileName: item.download_file_name || item.original_file_name || 'файл',
        linkCopied,
      });
      if (rotate) {
        notifySuccess('Создана новая публичная ссылка.', { source: 'my-files-share-rotate', dedupeMode: 'none' });
      }
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось создать публичную ссылку.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess, notifyWarning]);

  const revokeShare = useCallback(async (item) => {
    try {
      await myFilesAPI.revokeShare(item.id);
      notifySuccess('Публичная ссылка отключена.', { source: 'my-files-share', dedupeMode: 'none' });
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось отключить ссылку.', { dedupeMode: 'none' });
    }
  }, [loadData, notifyApiError, notifySuccess]);

  const shareFolder = useCallback(async (folder, { rotate = false } = {}) => {
    try {
      const payload = await myFilesAPI.createFolderShare(folder.id, { rotate });
      const publicUrl = myFilesAPI.buildPublicFolderUrl(payload.token);
      let linkCopied = false;
      try {
        await navigator.clipboard?.writeText(publicUrl);
        linkCopied = true;
      } catch {
        notifyWarning('Ссылка создана. Скопируйте её из окна.', { source: 'my-files-folder-share', dedupeMode: 'none' });
      }
      setFolderShareDialog({
        open: true,
        folderId: folder.id,
        url: publicUrl,
        folderName: folder.name || 'папка',
        linkCopied,
      });
      if (rotate) {
        notifySuccess('Создана новая публичная ссылка на папку.', { source: 'my-files-folder-share-rotate', dedupeMode: 'none' });
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось создать ссылку на папку.', { dedupeMode: 'none' });
    }
  }, [notifyApiError, notifySuccess, notifyWarning]);

  const revokeFolderShare = useCallback(async (folderId) => {
    try {
      await myFilesAPI.revokeFolderShare(folderId);
      setFolderShareDialog(EMPTY_FOLDER_SHARE);
      notifySuccess('Ссылка на папку отключена.', { source: 'my-files-folder-share', dedupeMode: 'none' });
    } catch (error) {
      notifyApiError(error, 'Не удалось отключить ссылку.', { dedupeMode: 'none' });
    }
  }, [notifyApiError, notifySuccess]);

  return {
    shareDialog,
    setShareDialog,
    folderShareDialog,
    setFolderShareDialog,
    shareFile,
    revokeShare,
    shareFolder,
    revokeFolderShare,
  };
}

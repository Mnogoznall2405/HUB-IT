import { useCallback, useState } from 'react';

import { myFilesAPI } from '../../api/myFiles';

export function useMyFilesDownload({ notifyApiError, notifySuccess, notifyWarning }) {
  const [downloadingFileId, setDownloadingFileId] = useState('');

  const downloadFile = useCallback(async (item) => {
    const fileId = String(item?.id || '').trim();
    if (!fileId) return;
    setDownloadingFileId(fileId);
    try {
      const grant = await myFilesAPI.createDownloadGrant(fileId);
      const downloadUrl = myFilesAPI.buildDownloadGrantUrl(grant?.download_path);
      if (!downloadUrl) {
        notifyWarning('Не удалось получить ссылку для скачивания.', { source: 'my-files-download', dedupeMode: 'none' });
        return;
      }
      if (!myFilesAPI.triggerNativeDownload(downloadUrl)) {
        notifyWarning('Браузер не смог начать скачивание.', { source: 'my-files-download', dedupeMode: 'none' });
        return;
      }
      notifySuccess('Скачивание запущено — смотрите панель загрузок браузера.', { source: 'my-files-download', dedupeMode: 'none', durationMs: 4000 });
    } catch (error) {
      notifyApiError(error, 'Не удалось скачать файл.', { dedupeMode: 'none' });
    } finally {
      setDownloadingFileId('');
    }
  }, [notifyApiError, notifySuccess, notifyWarning]);

  return { downloadingFileId, downloadFile };
}

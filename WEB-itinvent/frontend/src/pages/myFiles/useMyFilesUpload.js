import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  myFilesAPI,
  MY_FILES_MAX_UPLOAD_BYTES,
} from '../../api/myFiles';
import {
  consumeDesktopSharedFiles,
  DESKTOP_SHARED_FILES_EVENT,
} from '../../lib/desktopBridge';
import {
  collectFolderUploadDirs,
  folderDirPathOfFile,
  folderSiblingKey,
  indexFoldersBySibling,
} from '../../lib/myFilesFolderTree';
import {
  collectDataTransferFiles,
  isFolderFileSelection,
  summarizeFolderSelection,
} from '../../lib/myFilesFolderZip';
import { formatFileSize } from '../../lib/myFilesPreview';

const normalizeFiles = (value) => Array.from(value || []).filter(Boolean);

const UPLOAD_PARALLEL_FILES = 2;
const UPLOAD_LIST_REFRESH_EVERY = 8;
/** Чанк без progress-событий дольше этого — помечаем загрузку как зависшую (watchdog в api сам перезапустит чанк). */
const UPLOAD_STALL_MARK_MS = 90_000;

export function useMyFilesUpload({
  canWrite,
  currentFolderId,
  isSpecialView,
  allFolders,
  loadData,
  notifySuccess,
  notifyWarning,
  notifyApiError,
  quota,
}) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [retentionDays, setRetentionDays] = useState(1);
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [pendingFolderFiles, setPendingFolderFiles] = useState([]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [readingDrop, setReadingDrop] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadStats, setUploadStats] = useState({ total: 0, done: 0 });
  const [prepareStats, setPrepareStats] = useState({ total: 0, done: 0 });
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState(null);
  const uploadAbortRef = useRef(null);

  const resetFileInputs = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }, []);

  const quotaLimitBytes = useMemo(() => {
    const limit = Number(quota?.limit_bytes || 0);
    return limit > 0 ? limit : MY_FILES_MAX_UPLOAD_BYTES;
  }, [quota]);

  const queueUploads = useCallback(async (files, selectedRetentionDays = retentionDays, resolveFolderId = null, externalSignal = null) => {
    const selected = normalizeFiles(files);
    if (selected.length === 0) return;
    const controller = externalSignal ? null : new AbortController();
    const signal = externalSignal || controller.signal;
    if (controller) uploadAbortRef.current = controller;
    setUploading(true);
    setUploadProgress({});
    setUploadStats({ total: selected.length, done: 0 });
    const quotaFreeBytes = quota
      ? Math.max(0, Number(quota.remaining_bytes ?? (quotaLimitBytes - Number(quota.used_bytes || 0))))
      : null;
    try {
      let uploaded = 0;
      let processed = 0;
      const failures = [];
      let nextIndex = 0;
      const parallelChunks = selected.length > 1 ? 2 : 4;
      const workers = Array.from(
        { length: Math.min(UPLOAD_PARALLEL_FILES, selected.length) },
        async () => {
          while (nextIndex < selected.length && !signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const file = selected[index];
            if (Number(file?.size || 0) > MY_FILES_MAX_UPLOAD_BYTES) {
              failures.push(`«${file.name}» — больше 400 ГБ`);
              setUploadStats((current) => ({ ...current, done: current.done + 1 }));
              continue;
            }
            const targetFolderId = typeof resolveFolderId === 'function'
              ? resolveFolderId(file)
              : (uploadTargetFolderId || currentFolderId);
            const progressKey = `${index}::${String(file?.webkitRelativePath || file?.name || 'file')}`;
            const displayName = String(file?.webkitRelativePath || file?.name || 'file');
            try {
              await myFilesAPI.uploadFile({
                file,
                retentionDays: selectedRetentionDays,
                folderId: targetFolderId,
                parallelChunks,
                signal,
                onUploadProgress: (event) => {
                  const total = Number(event?.total || file.size || 0);
                  const loaded = Number(event?.loaded || 0);
                  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
                  const now = Date.now();
                  setUploadProgress((current) => (
                    current[progressKey]?.percent === percent && !current[progressKey]?.stalled
                      ? current
                      : { ...current, [progressKey]: { name: displayName, percent, updatedAt: now, stalled: false } }
                  ));
                },
              });
              uploaded += 1;
            } catch (error) {
              const aborted = signal.aborted || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED';
              if (!aborted) {
                const status = Number(error?.response?.status || 0);
                const rawDetail = String(error?.response?.data?.detail || error?.message || 'ошибка сети');
                const detail = status === 413
                  ? 'превышен лимит сервера'
                  : (status === 400 && /quota/i.test(rawDetail)
                    ? `не помещается в квоту${quotaFreeBytes != null ? ` (свободно ${formatFileSize(quotaFreeBytes)})` : ''}`
                    : rawDetail);
                failures.push(`«${file.name}» — ${detail}`);
              }
            } finally {
              setUploadProgress((current) => {
                if (!(progressKey in current)) return current;
                const next = { ...current };
                delete next[progressKey];
                return next;
              });
              setUploadStats((current) => ({ ...current, done: current.done + 1 }));
              processed += 1;
              if (processed % UPLOAD_LIST_REFRESH_EVERY === 0) {
                void loadData({ silent: true });
              }
            }
          }
        },
      );
      await Promise.all(workers);
      if (signal.aborted) {
        notifyWarning(
          `Загрузка отменена. Успели загрузиться: ${uploaded} из ${selected.length}.${failures.length > 0 ? ` Ошибок: ${failures.length}.` : ''}`,
          { source: 'my-files-upload-cancelled', dedupeMode: 'none' },
        );
      } else {
        if (uploaded > 0) {
          notifySuccess(`Загружено файлов: ${uploaded}. Они добавлены в очередь обработки.`, { source: 'my-files-upload', dedupeMode: 'none' });
        }
        if (failures.length > 0) {
          notifyWarning(
            `Не удалось загрузить: ${failures.slice(0, 5).join('; ')}${failures.length > 5 ? ` и ещё ${failures.length - 5}` : ''}. Загрузку можно повторить — она продолжится с места обрыва.`,
            { source: 'my-files-upload-failed', dedupeMode: 'none', durationMs: 9000 },
          );
        }
      }
      await loadData({ silent: true });
    } catch (error) {
      notifyApiError(error, 'Не удалось загрузить файл.', { dedupeMode: 'none' });
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
      setUploadProgress({});
      setUploadStats({ total: 0, done: 0 });
      resetFileInputs();
    }
  }, [currentFolderId, loadData, notifyApiError, notifySuccess, notifyWarning, quota, quotaLimitBytes, resetFileInputs, retentionDays, uploadTargetFolderId]);

  const openUploadDialog = useCallback((files, { asFolder = false, targetFolderId = null } = {}) => {
    if (!canWrite) return;
    const selected = normalizeFiles(files);
    if (selected.length === 0) return;
    setUploadTargetFolderId(targetFolderId || null);

    const folderMode = asFolder || isFolderFileSelection(selected);
    if (folderMode) {
      const summary = summarizeFolderSelection(selected);
      if (summary.fileCount === 0) {
        notifyWarning('Папка пуста — нечего загружать.', { source: 'my-files-upload', dedupeMode: 'none' });
        resetFileInputs();
        return;
      }
      const freeBytes = quota
        ? Math.max(0, Number(quota.remaining_bytes ?? quotaLimitBytes))
        : quotaLimitBytes;
      if (summary.totalBytes > freeBytes) {
        notifyWarning(
          `Папка «${summary.folderName}» (${formatFileSize(summary.totalBytes)}) не помещается в квоту (свободно ${formatFileSize(freeBytes)}).`,
          { source: 'my-files-upload', dedupeMode: 'none' },
        );
        resetFileInputs();
        return;
      }
      setRetentionDays(1);
      setPendingFolderFiles(selected);
      setPendingUploadFiles([]);
      setUploadDialogOpen(true);
      return;
    }

    setRetentionDays(1);
    setPendingFolderFiles([]);
    setPendingUploadFiles(selected);
    setUploadDialogOpen(true);
  }, [canWrite, notifyWarning, quota, quotaLimitBytes, resetFileInputs]);

  const acceptDesktopSharedFiles = useCallback(() => {
    const files = consumeDesktopSharedFiles();
    if (files.length === 0) return;
    if (!canWrite) {
      notifyWarning('Нет прав на загрузку файлов в «Мои файлы».', {
        source: 'my-files-upload',
        dedupeMode: 'none',
      });
      return;
    }
    openUploadDialog(files);
  }, [canWrite, notifyWarning, openUploadDialog]);

  useEffect(() => {
    acceptDesktopSharedFiles();
    window.addEventListener(DESKTOP_SHARED_FILES_EVENT, acceptDesktopSharedFiles);
    return () => window.removeEventListener(DESKTOP_SHARED_FILES_EVENT, acceptDesktopSharedFiles);
  }, [acceptDesktopSharedFiles]);

  const closeUploadDialog = useCallback(() => {
    if (uploading) return;
    setUploadDialogOpen(false);
    setPendingUploadFiles([]);
    setPendingFolderFiles([]);
    setUploadTargetFolderId(null);
    resetFileInputs();
  }, [resetFileInputs, uploading]);

  const confirmUpload = useCallback(() => {
    const selectedRetentionDays = retentionDays;
    const folderFiles = pendingFolderFiles;
    const selected = pendingUploadFiles;
    const baseFolderId = uploadTargetFolderId || currentFolderId || null;

    if (folderFiles.length > 0) {
      setUploadDialogOpen(false);
      setPendingFolderFiles([]);
      setPendingUploadFiles([]);
      setUploadTargetFolderId(null);
      void (async () => {
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        setUploading(true);
        try {
          const dirToId = new Map([['', baseFolderId]]);
          const existing = indexFoldersBySibling(allFolders);
          const dirs = collectFolderUploadDirs(folderFiles);
          setPrepareStats({ total: dirs.length, done: 0 });
          for (const dirPath of dirs) {
            if (controller.signal.aborted) break;
            const parts = dirPath.split('/');
            const name = parts[parts.length - 1];
            const parentId = dirToId.get(parts.slice(0, -1).join('/')) || null;
            const key = folderSiblingKey(parentId, name);
            if (existing.has(key)) {
              dirToId.set(dirPath, existing.get(key));
            } else {
              const created = await myFilesAPI.createFolder({ name, parentId });
              dirToId.set(dirPath, String(created.id));
              existing.set(key, String(created.id));
            }
            setPrepareStats((current) => ({ ...current, done: current.done + 1 }));
          }
          setPrepareStats({ total: 0, done: 0 });
          await queueUploads(folderFiles, selectedRetentionDays, (file) => {
            const dirPath = folderDirPathOfFile(file);
            return dirToId.get(dirPath) || baseFolderId;
          }, controller.signal);
        } catch (error) {
          setUploading(false);
          setUploadProgress({});
          setUploadStats({ total: 0, done: 0 });
          setPrepareStats({ total: 0, done: 0 });
          resetFileInputs();
          notifyApiError(error, 'Не удалось создать структуру папок.', { dedupeMode: 'none' });
        } finally {
          uploadAbortRef.current = null;
        }
      })();
      return;
    }

    if (selected.length === 0) return;
    setUploadDialogOpen(false);
    setPendingUploadFiles([]);
    setPendingFolderFiles([]);
    setUploadTargetFolderId(null);
    void queueUploads(selected, selectedRetentionDays, () => baseFolderId);
  }, [
    notifyApiError,
    allFolders,
    currentFolderId,
    pendingFolderFiles,
    pendingUploadFiles,
    queueUploads,
    resetFileInputs,
    retentionDays,
    uploadTargetFolderId,
  ]);

  const handleInputChange = useCallback((event) => {
    openUploadDialog(event.target.files, { asFolder: false });
  }, [openUploadDialog]);

  const handleFolderInputChange = useCallback((event) => {
    openUploadDialog(event.target.files, { asFolder: true });
  }, [openUploadDialog]);

  const handleDrop = useCallback(async (event) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer?.types?.includes('application/x-hubit-file')) return;
    if (!canWrite || uploading || readingDrop) return;
    setReadingDrop(true);
    try {
      const { files, asFolder } = await collectDataTransferFiles(event.dataTransfer);
      if (!files.length) {
        notifyWarning('Не удалось прочитать перетащенные файлы или папку.', {
          source: 'my-files-upload',
          dedupeMode: 'none',
        });
        return;
      }
      openUploadDialog(files, { asFolder });
    } catch (error) {
      notifyApiError(error, 'Не удалось прочитать перетащенную папку.', { dedupeMode: 'none' });
    } finally {
      setReadingDrop(false);
    }
  }, [canWrite, notifyApiError, notifyWarning, openUploadDialog, readingDrop, uploading]);

  // Window-level drag tracking: показываем оверлей, пока файлы ОС над страницей,
  // и ловим drop в любой точке — как на Google Диске. Внутренние перетаскивания
  // файлов по папкам (application/x-hubit-file) оверлей не включают.
  useEffect(() => {
    if (!canWrite || uploading || isSpecialView) return undefined;
    let depth = 0;
    const isOsFileDrag = (event) => {
      const types = event?.dataTransfer?.types;
      return Boolean(types?.includes('Files')) && !types?.includes('application/x-hubit-file');
    };
    const onEnter = (event) => {
      if (!isOsFileDrag(event)) return;
      depth += 1;
      setDragActive(true);
    };
    const onLeave = (event) => {
      if (!isOsFileDrag(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragActive(false);
    };
    const onOver = (event) => {
      if (isOsFileDrag(event)) event.preventDefault();
    };
    const onDropAnywhere = (event) => {
      if (!isOsFileDrag(event)) return;
      depth = 0;
      setDragActive(false);
      void handleDrop(event);
    };
    const onEnd = () => { depth = 0; setDragActive(false); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDropAnywhere);
    window.addEventListener('dragend', onEnd);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDropAnywhere);
      window.removeEventListener('dragend', onEnd);
    };
  }, [canWrite, uploading, isSpecialView, handleDrop]);

  const pendingFolderSummary = useMemo(
    () => (pendingFolderFiles.length > 0 ? summarizeFolderSelection(pendingFolderFiles) : null),
    [pendingFolderFiles],
  );

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!uploading) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uploading]);

  useEffect(() => {
    if (!uploading) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setUploadProgress((current) => {
        let changed = false;
        const next = { ...current };
        for (const key of Object.keys(next)) {
          const item = next[key];
          const stale = now - Number(item?.updatedAt || 0) > UPLOAD_STALL_MARK_MS;
          if (stale !== Boolean(item?.stalled)) {
            next[key] = { ...item, stalled: stale };
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [uploading]);

  return {
    uploading,
    readingDrop,
    uploadProgress,
    uploadStats,
    prepareStats,
    cancelUpload,
    uploadDialogOpen,
    pendingUploadFiles,
    pendingFolderFiles,
    pendingFolderSummary,
    retentionDays,
    setRetentionDays,
    dragActive,
    setDragActive,
    fileInputRef,
    folderInputRef,
    openUploadDialog,
    closeUploadDialog,
    confirmUpload,
    handleInputChange,
    handleFolderInputChange,
    handleDrop,
  };
}

import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import {
  buildChatUploadSignature,
  isChatMediaFile,
  prepareChatUploadFile,
  prepareChatUploadFiles,
} from './chatUploadPrep';
import {
  CHAT_MAX_FILE_BYTES,
  CHAT_MAX_FILE_COUNT,
  formatFileSize,
  isArchiveFile,
} from './chatHelpers';

const CHAT_ARCHIVE_UPLOAD_WARNING = 'Архивы (.zip, .rar, .7z, .tar, .gz) нельзя отправлять в чат.';
const CHAT_SEND_MEDIA_AS_FILES_MAX_BYTES = 25 * 1024 * 1024;
const CHAT_SEND_MEDIA_AS_FILES_SIZE_WARNING = 'Суммарный размер оригиналов превышает 25 МБ.';
const CHAT_EDITED_MEDIA_ORIGINAL_WARNING = 'Сбросьте изменения фотографии, чтобы отправить оригинал.';

export const buildChatSendUploadItems = (items, sendMediaAsFiles = false) => (
  (Array.isArray(items) ? items : []).map((item) => {
    const originalFile = item?.originalFile || item?.file || null;
    if (!sendMediaAsFiles || item?.imageEdit || !isChatMediaFile(originalFile)) return item;
    const originalSize = Number(originalFile?.size || 0);
    return {
      ...item,
      originalFile,
      file: originalFile,
      transferFile: originalFile,
      originalSize,
      preparedSize: originalSize,
      transferSize: originalSize,
      finalSize: originalSize,
      transferEncoding: 'identity',
      media_kind: 'file',
      mediaKind: 'file',
      wasPrepared: false,
      imageWasPrepared: false,
      transportWasPrepared: false,
      changedFormat: false,
    };
  })
);

const getChatUploadItemsTotalBytes = (items) => (
  (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Number(item?.transferSize || item?.transferFile?.size || item?.file?.size || 0),
    0,
  )
);

const getChatUploadItemsOriginalTotalBytes = (items) => (
  (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Number(item?.originalFile?.size || item?.originalSize || item?.file?.size || 0),
    0,
  )
);

export default function useChatFileSending({
  activeConversation,
  activeConversationId,
  applyOutgoingThreadMessage,
  buildReplyPreview,
  cancelPendingInitialAnchor,
  createOptimisticFileMessage,
  fileCaption,
  fileInputRef,
  fileUploadAbortRef,
  loadChatDialogsModule,
  logChatDebug,
  mediaFileInputRef,
  notifyApiError,
  notifyWarning,
  patchThreadMessage,
  preparingFiles,
  removeThreadMessage,
  replyMessage,
  revokeObjectUrls,
  sendMediaAsFiles,
  selectedFiles,
  selectedUploadItems,
  sendingFiles,
  setComposerMenuAnchor,
  setEmojiAnchorEl,
  setFileCaption,
  setFileDialogOpen,
  setFileUploadProgress,
  setOptimisticAiQueuedStatus,
  setPreparingFiles,
  setReplyMessage,
  setSendMediaAsFiles,
  setSelectedUploadItems,
  setSendingFiles,
  setThreadMenuAnchor,
}) {
  const queueSelectedFiles = useCallback(async (files, options = {}) => {
    if (preparingFiles || sendingFiles) return false;

    const incomingFiles = Array.from(files || []).filter(Boolean);
    if (incomingFiles.length === 0) return false;

    const existingItems = Array.isArray(selectedUploadItems) ? selectedUploadItems : [];
    const archiveFiles = incomingFiles.filter((file) => isArchiveFile(file));
    if (archiveFiles.length > 0) {
      notifyWarning?.(CHAT_ARCHIVE_UPLOAD_WARNING);
    }
    const allowedIncomingFiles = incomingFiles.filter((file) => !isArchiveFile(file));
    if (allowedIncomingFiles.length === 0) {
      if (existingItems.length > 0) setFileDialogOpen(true);
      return false;
    }
    const seenSignatures = new Set(
      existingItems
        .map((item) => String(item?.signature || buildChatUploadSignature(item?.file || item)).trim())
        .filter(Boolean),
    );
    const uniqueIncomingFiles = allowedIncomingFiles.filter((file) => {
      const signature = buildChatUploadSignature(file);
      if (!signature || seenSignatures.has(signature)) {
        return false;
      }
      seenSignatures.add(signature);
      return true;
    });

    if (uniqueIncomingFiles.length === 0) {
      if (existingItems.length > 0) setFileDialogOpen(true);
      return false;
    }

    if ((existingItems.length + uniqueIncomingFiles.length) > CHAT_MAX_FILE_COUNT) {
      notifyWarning?.(`Можно отправить не более ${CHAT_MAX_FILE_COUNT} файлов за один раз.`);
      return false;
    }

    const hasRequestedMediaMode = typeof options?.sendMediaAsFiles === 'boolean';
    const requestedMediaAsFiles = options?.sendMediaAsFiles === true;
    const requestedOriginalTotalBytes = (
      getChatUploadItemsOriginalTotalBytes(existingItems)
      + uniqueIncomingFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0)
    );
    const canUseRequestedOriginalMode = (
      requestedMediaAsFiles
      && requestedOriginalTotalBytes <= CHAT_SEND_MEDIA_AS_FILES_MAX_BYTES
    );
    if (requestedMediaAsFiles && !canUseRequestedOriginalMode) {
      notifyWarning?.(CHAT_SEND_MEDIA_AS_FILES_SIZE_WARNING);
    }

    setFileDialogOpen(true);
    if (existingItems.length === 0 || (hasRequestedMediaMode && !canUseRequestedOriginalMode)) {
      setSendMediaAsFiles(false);
    }
    setPreparingFiles(true);
    setFileUploadProgress(0);

    try {
      const optimisticTotalBytes = (
        existingItems.reduce((sum, item) => sum + Number(item?.file?.size || 0), 0)
        + uniqueIncomingFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0)
      );
      const prepareOptions = optimisticTotalBytes > CHAT_MAX_FILE_BYTES
        ? { forcePrepare: true, prepareAboveBytes: 0 }
        : {};
      const preparedResult = await prepareChatUploadFiles(
        uniqueIncomingFiles,
        prepareOptions,
      );
      const preparedItems = Array.isArray(preparedResult?.items) ? preparedResult.items : [];
      const nextItems = [...existingItems, ...preparedItems];
      const totalBytes = nextItems.reduce((sum, item) => sum + Number(item?.file?.size || 0), 0);
      if (totalBytes > CHAT_MAX_FILE_BYTES) {
        notifyWarning?.(`Суммарный размер файлов после подготовки превышает ${formatFileSize(CHAT_MAX_FILE_BYTES)}.`);
        return false;
      }
      setSelectedUploadItems(nextItems);
      if (hasRequestedMediaMode) {
        const hasMedia = nextItems.some((item) => isChatMediaFile(item?.originalFile || item?.file));
        setSendMediaAsFiles(Boolean(hasMedia && canUseRequestedOriginalMode));
      }
      return true;
    } catch {
      notifyWarning?.('Не удалось подготовить файлы к отправке.');
      return false;
    } finally {
      setPreparingFiles(false);
    }
  }, [
    notifyWarning,
    preparingFiles,
    selectedUploadItems,
    sendingFiles,
    setFileDialogOpen,
    setFileUploadProgress,
    setPreparingFiles,
    setSendMediaAsFiles,
    setSelectedUploadItems,
  ]);

  const changeSendMediaAsFiles = useCallback((nextValue) => {
    if (preparingFiles || sendingFiles) return false;
    const checked = Boolean(nextValue);
    if (checked) {
      if (selectedUploadItems.some((item) => Boolean(item?.imageEdit))) {
        notifyWarning?.(CHAT_EDITED_MEDIA_ORIGINAL_WARNING);
        return false;
      }
      if (getChatUploadItemsOriginalTotalBytes(selectedUploadItems) > CHAT_SEND_MEDIA_AS_FILES_MAX_BYTES) {
        notifyWarning?.(CHAT_SEND_MEDIA_AS_FILES_SIZE_WARNING);
        return false;
      }
    }
    setSendMediaAsFiles(checked);
    return true;
  }, [
    notifyWarning,
    preparingFiles,
    selectedUploadItems,
    sendingFiles,
    setSendMediaAsFiles,
  ]);

  const applySelectedImageEdit = useCallback(async (fileIndex, payload = {}) => {
    if (preparingFiles || sendingFiles || !payload?.file) return false;
    const normalizedIndex = Number(fileIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return false;
    const currentItem = selectedUploadItems[normalizedIndex];
    if (!currentItem) return false;

    setPreparingFiles(true);
    try {
      const preparedEditedItem = await prepareChatUploadFile(payload.file);
      const nextItems = selectedUploadItems.map((item, index) => {
        if (index !== normalizedIndex) return item;
        return {
          ...preparedEditedItem,
          signature: item?.signature || preparedEditedItem?.signature,
          originalFile: item?.originalFile || item?.file || payload.file,
          originalSize: Number(item?.originalSize || item?.originalFile?.size || item?.file?.size || 0),
          imageEdit: {
            recipe: payload?.recipe || { version: 1, operations: [] },
            revision: Number(item?.imageEdit?.revision || 0) + 1,
          },
        };
      });
      if (getChatUploadItemsTotalBytes(nextItems) > CHAT_MAX_FILE_BYTES) {
        notifyWarning?.(`Суммарный размер файлов после редактирования превышает ${formatFileSize(CHAT_MAX_FILE_BYTES)}.`);
        return false;
      }
      setSelectedUploadItems(nextItems);
      setSendMediaAsFiles(false);
      return true;
    } catch {
      notifyWarning?.('Не удалось подготовить отредактированное фото к отправке.');
      return false;
    } finally {
      setPreparingFiles(false);
    }
  }, [
    notifyWarning,
    preparingFiles,
    selectedUploadItems,
    sendingFiles,
    setPreparingFiles,
    setSendMediaAsFiles,
    setSelectedUploadItems,
  ]);

  const resetSelectedImageEdit = useCallback(async (fileIndex) => {
    if (preparingFiles || sendingFiles) return false;
    const normalizedIndex = Number(fileIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return false;
    const currentItem = selectedUploadItems[normalizedIndex];
    const originalFile = currentItem?.originalFile || null;
    if (!currentItem || !originalFile) return false;

    setPreparingFiles(true);
    try {
      const restoredItem = await prepareChatUploadFile(originalFile);
      const nextItems = selectedUploadItems.map((item, index) => (
        index === normalizedIndex
          ? {
            ...restoredItem,
            signature: item?.signature || restoredItem?.signature,
            originalFile,
            originalSize: Number(originalFile?.size || 0),
          }
          : item
      ));
      setSelectedUploadItems(nextItems);
      return true;
    } catch {
      notifyWarning?.('Не удалось восстановить исходное фото.');
      return false;
    } finally {
      setPreparingFiles(false);
    }
  }, [
    notifyWarning,
    preparingFiles,
    selectedUploadItems,
    sendingFiles,
    setPreparingFiles,
    setSelectedUploadItems,
  ]);

  const handleSelectFiles = useCallback((event) => {
    if (preparingFiles || sendingFiles) return;
    const files = Array.from(event?.target?.files || []);
    if (event?.target) event.target.value = '';
    void queueSelectedFiles(files);
  }, [preparingFiles, queueSelectedFiles, sendingFiles]);

  const openFilePicker = useCallback(() => {
    void loadChatDialogsModule();
    setThreadMenuAnchor(null);
    setComposerMenuAnchor(null);
    setEmojiAnchorEl(null);
    if (preparingFiles || sendingFiles) return;
    if (selectedFiles.length > 0) {
      setFileDialogOpen(true);
      return;
    }
    fileInputRef.current?.click?.();
  }, [
    fileInputRef,
    loadChatDialogsModule,
    preparingFiles,
    selectedFiles.length,
    sendingFiles,
    setComposerMenuAnchor,
    setEmojiAnchorEl,
    setFileDialogOpen,
    setThreadMenuAnchor,
  ]);

  const openMediaPicker = useCallback(() => {
    void loadChatDialogsModule();
    setComposerMenuAnchor(null);
    setEmojiAnchorEl(null);
    if (preparingFiles || sendingFiles) return;
    if (selectedFiles.length > 0) {
      setFileDialogOpen(true);
      return;
    }
    mediaFileInputRef.current?.click?.();
  }, [
    loadChatDialogsModule,
    mediaFileInputRef,
    preparingFiles,
    selectedFiles.length,
    sendingFiles,
    setComposerMenuAnchor,
    setEmojiAnchorEl,
    setFileDialogOpen,
  ]);

  const sendFiles = useCallback(async () => {
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || selectedFiles.length === 0 || preparingFiles || sendingFiles) return;

    // Capture current state into local variables before clearing UI
    const snapshotUploadItems = buildChatSendUploadItems(selectedUploadItems, sendMediaAsFiles);
    const snapshotFiles = snapshotUploadItems.map((item) => item?.file).filter(Boolean);
    const snapshotCaption = fileCaption;
    if (
      sendMediaAsFiles
      && getChatUploadItemsOriginalTotalBytes(selectedUploadItems) > CHAT_SEND_MEDIA_AS_FILES_MAX_BYTES
    ) {
      setSendMediaAsFiles(false);
      notifyWarning?.(CHAT_SEND_MEDIA_AS_FILES_SIZE_WARNING);
      return;
    }
    const totalBytes = getChatUploadItemsTotalBytes(snapshotUploadItems);
    if (totalBytes > CHAT_MAX_FILE_BYTES) {
      notifyWarning?.(`Суммарный размер файлов превышает ${formatFileSize(CHAT_MAX_FILE_BYTES)}.`);
      return;
    }
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const draftReplyMessage = replyMessage ? { ...replyMessage } : null;
    const optimisticMessage = createOptimisticFileMessage({
      conversationId,
      files: snapshotFiles,
      mediaKinds: snapshotUploadItems.map((item) => item?.media_kind || item?.mediaKind || ''),
      body: snapshotCaption,
      replyPreview: buildReplyPreview(draftReplyMessage),
    });
    fileUploadAbortRef.current = abortController;

    // Clear UI immediately — dialog closes, composer is free
    setSelectedUploadItems([]);
    setFileCaption('');
    setFileDialogOpen(false);
    setSendMediaAsFiles(false);
    setFileUploadProgress(0);
    setReplyMessage(null);
    setSendingFiles(true);

    if (optimisticMessage) {
      applyOutgoingThreadMessage(conversationId, optimisticMessage, {
        scroll: true,
        scrollSource: 'sendFiles',
      });
    }

    try {
      const serverMessage = await chatAPI.sendFiles(conversationId, snapshotUploadItems, {
        body: snapshotCaption,
        reply_to_message_id: draftReplyMessage?.id || undefined,
        signal: abortController?.signal,
        onUploadProgress: (progressEvent) => {
          const loaded = Number(progressEvent?.loaded || 0);
          const total = Number(progressEvent?.total || totalBytes || 0);
          if (total <= 0) return;
          const nextProgress = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
          if (optimisticMessage?.id) {
            patchThreadMessage(optimisticMessage.id, { uploadProgress: nextProgress });
          }
        },
      });
      cancelPendingInitialAnchor();
      logChatDebug('sendFiles:autoScroll', {
        conversationId,
      });
      if (serverMessage?.id) {
        applyOutgoingThreadMessage(conversationId, serverMessage, {
          replaceId: optimisticMessage?.id,
          scroll: true,
          scrollSource: 'sendFiles:server',
        });
        if (activeConversation?.kind === 'ai') {
          setOptimisticAiQueuedStatus(conversationId, activeConversation?.title);
        }
      } else if (optimisticMessage?.id) {
        removeThreadMessage(optimisticMessage.id);
      }
    } catch (error) {
      if (optimisticMessage?.id) {
        removeThreadMessage(optimisticMessage.id);
      }
      if (String(error?.code || '') !== 'ERR_CANCELED') {
        notifyApiError(error, 'Не удалось отправить файлы в чат.');
      }
    } finally {
      revokeObjectUrls(optimisticMessage?.optimisticObjectUrls);
      fileUploadAbortRef.current = null;
      setSendingFiles(false);
      setFileUploadProgress(0);
    }
  }, [
    activeConversation?.kind,
    activeConversation?.title,
    activeConversationId,
    applyOutgoingThreadMessage,
    buildReplyPreview,
    cancelPendingInitialAnchor,
    createOptimisticFileMessage,
    fileCaption,
    fileUploadAbortRef,
    logChatDebug,
    notifyApiError,
    patchThreadMessage,
    preparingFiles,
    removeThreadMessage,
    replyMessage,
    revokeObjectUrls,
    sendMediaAsFiles,
    selectedFiles,
    selectedUploadItems,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    setSendMediaAsFiles,
    setSelectedUploadItems,
    setSendingFiles,
  ]);

  const closeFileDialog = useCallback(() => {
    if (preparingFiles || sendingFiles) return;
    setFileDialogOpen(false);
    setSendMediaAsFiles(false);
    setSelectedUploadItems([]);
    setFileCaption('');
    setFileUploadProgress(0);
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setSendMediaAsFiles,
    setSelectedUploadItems,
  ]);

  const clearSelectedFiles = useCallback(() => {
    if (preparingFiles || sendingFiles) return;
    setFileDialogOpen(false);
    setSendMediaAsFiles(false);
    setSelectedUploadItems([]);
    setFileCaption('');
    setFileUploadProgress(0);
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setSendMediaAsFiles,
    setSelectedUploadItems,
  ]);

  const removeSelectedFile = useCallback((fileIndex) => {
    if (preparingFiles || sendingFiles) return;
    const normalizedIndex = Number(fileIndex);
    if (!Number.isInteger(normalizedIndex) || normalizedIndex < 0) return;
    setSelectedUploadItems((current) => {
      const next = (Array.isArray(current) ? current : []).filter((_, index) => index !== normalizedIndex);
      if (next.length === 0) {
        setFileDialogOpen(false);
        setFileCaption('');
        setFileUploadProgress(0);
        setSendMediaAsFiles(false);
      }
      return next;
    });
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setSendMediaAsFiles,
    setSelectedUploadItems,
  ]);

  return {
    applySelectedImageEdit,
    changeSendMediaAsFiles,
    clearSelectedFiles,
    closeFileDialog,
    handleSelectFiles,
    openFilePicker,
    openMediaPicker,
    queueSelectedFiles,
    removeSelectedFile,
    resetSelectedImageEdit,
    sendFiles,
  };
}


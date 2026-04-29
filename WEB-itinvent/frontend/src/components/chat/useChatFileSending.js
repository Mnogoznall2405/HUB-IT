import { useCallback } from 'react';

import { chatAPI } from '../../api/client';
import {
  buildChatUploadSignature,
  prepareChatUploadFiles,
} from './chatUploadPrep';
import {
  CHAT_MAX_FILE_BYTES,
  CHAT_MAX_FILE_COUNT,
  isArchiveFile,
} from './chatHelpers';

const CHAT_ARCHIVE_UPLOAD_WARNING = 'Архивы (.zip, .rar, .7z, .tar, .gz) нельзя отправлять в чат.';

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
  setSelectedUploadItems,
  setSendingFiles,
  setThreadMenuAnchor,
}) {
  const queueSelectedFiles = useCallback(async (files) => {
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

    setFileDialogOpen(true);
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
        notifyWarning?.('Суммарный размер файлов после подготовки превышает 25 МБ.');
        return false;
      }
      setSelectedUploadItems(nextItems);
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
    if (!conversationId || selectedFiles.length === 0 || preparingFiles) return;

    const totalBytes = selectedUploadItems.reduce(
      (sum, item) => sum + Number(item?.transferSize || item?.transferFile?.size || item?.file?.size || 0),
      0,
    );
    const abortController = typeof AbortController === 'function' ? new AbortController() : null;
    const draftReplyMessage = replyMessage ? { ...replyMessage } : null;
    const optimisticMessage = createOptimisticFileMessage({
      conversationId,
      files: selectedFiles,
      body: fileCaption,
      replyPreview: buildReplyPreview(draftReplyMessage),
    });
    fileUploadAbortRef.current = abortController;
    setSendingFiles(true);
    setFileUploadProgress(0);
    if (optimisticMessage) {
      applyOutgoingThreadMessage(conversationId, optimisticMessage, {
        scroll: true,
        scrollSource: 'sendFiles',
      });
    }

    try {
      const serverMessage = await chatAPI.sendFiles(conversationId, selectedUploadItems, {
        body: fileCaption,
        reply_to_message_id: draftReplyMessage?.id || undefined,
        signal: abortController?.signal,
        onUploadProgress: (progressEvent) => {
          const loaded = Number(progressEvent?.loaded || 0);
          const total = Number(progressEvent?.total || totalBytes || 0);
          if (total <= 0) return;
          const nextProgress = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
          setFileUploadProgress(nextProgress);
          if (optimisticMessage?.id) {
            patchThreadMessage(optimisticMessage.id, { uploadProgress: nextProgress });
          }
        },
      });
      setSelectedUploadItems([]);
      setFileCaption('');
      setFileDialogOpen(false);
      setFileUploadProgress(0);
      setReplyMessage(null);
      cancelPendingInitialAnchor();
      logChatDebug('sendFiles:autoScroll', {
        conversationId,
      });
      if (serverMessage?.id) {
        applyOutgoingThreadMessage(conversationId, serverMessage, {
          replaceId: optimisticMessage?.id,
          scroll: false,
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
    selectedFiles,
    selectedUploadItems,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setOptimisticAiQueuedStatus,
    setReplyMessage,
    setSelectedUploadItems,
    setSendingFiles,
  ]);

  const closeFileDialog = useCallback(() => {
    if (preparingFiles || sendingFiles) return;
    setFileDialogOpen(false);
    setSelectedUploadItems([]);
    setFileCaption('');
    setFileUploadProgress(0);
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setSelectedUploadItems,
  ]);

  const clearSelectedFiles = useCallback(() => {
    if (preparingFiles || sendingFiles) return;
    setFileDialogOpen(false);
    setSelectedUploadItems([]);
    setFileCaption('');
    setFileUploadProgress(0);
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
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
      }
      return next;
    });
  }, [
    preparingFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileUploadProgress,
    setSelectedUploadItems,
  ]);

  return {
    clearSelectedFiles,
    closeFileDialog,
    handleSelectFiles,
    openFilePicker,
    openMediaPicker,
    queueSelectedFiles,
    removeSelectedFile,
    sendFiles,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';
import {
  summarizePreparedChatUploadItems,
} from '../../components/chat/chatUploadPrep';
import useChatFileSending from '../../components/chat/useChatFileSending';
import useVoiceRecorder from '../../components/chat/useVoiceRecorder';

export default function useChatUploadsController({
  activeConversation,
  activeConversationId,
  applyOutgoingThreadMessage,
  buildReplyPreview,
  cancelPendingInitialAnchor,
  createOptimisticFileMessage,
  fileInputRef,
  loadChatDialogsModule,
  logChatDebug,
  mediaFileInputRef,
  notifyApiError,
  notifyWarning,
  patchThreadMessage,
  removeThreadMessage,
  replyMessage,
  revokeObjectUrls,
  setComposerMenuAnchor,
  setEmojiAnchorEl,
  setOptimisticAiQueuedStatus,
  setReplyMessage,
  setThreadMenuAnchor,
}) {
  const fileUploadAbortRef = useRef(null);

  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [selectedUploadItems, setSelectedUploadItems] = useState([]);
  const [fileCaption, setFileCaption] = useState('');
  const [preparingFiles, setPreparingFiles] = useState(false);
  const [sendingFiles, setSendingFiles] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(0);
  const [fileDragActive, setFileDragActive] = useState(false);

  const selectedFiles = useMemo(
    () => selectedUploadItems.map((item) => item?.file).filter(Boolean),
    [selectedUploadItems],
  );

  const selectedFilesSummary = useMemo(
    () => summarizePreparedChatUploadItems(selectedUploadItems),
    [selectedUploadItems],
  );

  useEffect(() => () => {
    try {
      fileUploadAbortRef.current?.abort?.();
    } catch {
      // Ignore abort cleanup failures on unmount.
    }
  }, []);

  const {
    clearSelectedFiles,
    closeFileDialog,
    handleSelectFiles,
    openFilePicker,
    openMediaPicker,
    queueSelectedFiles,
    removeSelectedFile,
    sendFiles,
  } = useChatFileSending({
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
  });

  const handleVoiceRecordingComplete = useCallback(async ({ file, duration, mimeType }) => {
    const conversationId = String(activeConversationId || '').trim();
    if (!conversationId || !file) return;
    try {
      await chatAPI.sendFiles(conversationId, [{
        file,
        media_kind: 'audio',
        duration_seconds: duration,
        mime_type: mimeType || file.type || 'audio/webm',
      }], {});
    } catch (error) {
      notifyApiError(error, 'Не удалось отправить голосовое сообщение.');
    }
  }, [activeConversationId, notifyApiError]);

  const {
    voiceRecording,
    voiceRecordingDuration,
    voiceRecordingLevelRef,
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
  } = useVoiceRecorder({
    onRecordingComplete: handleVoiceRecordingComplete,
    notifyWarning,
  });

  const handleComposerPaste = useCallback((event) => {
    const files = Array.from(event?.clipboardData?.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    void queueSelectedFiles(files);
  }, [queueSelectedFiles]);

  const handleComposerDragOver = useCallback((event) => {
    if (!event?.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileDragActive(true);
  }, []);

  const handleComposerDragLeave = useCallback((event) => {
    if (!event?.currentTarget?.contains(event?.relatedTarget)) {
      setFileDragActive(false);
    }
  }, []);

  const handleComposerDrop = useCallback((event) => {
    if (!event?.dataTransfer?.files?.length) return;
    event.preventDefault();
    setFileDragActive(false);
    void queueSelectedFiles(Array.from(event.dataTransfer.files || []));
  }, [queueSelectedFiles]);

  return {
    cancelVoiceRecording,
    clearSelectedFiles,
    closeFileDialog,
    fileCaption,
    fileDialogOpen,
    fileDragActive,
    fileUploadProgress,
    handleComposerDragLeave,
    handleComposerDragOver,
    handleComposerDrop,
    handleComposerPaste,
    handleSelectFiles,
    mediaFileInputRef,
    openFilePicker,
    openMediaPicker,
    preparingFiles,
    queueSelectedFiles,
    removeSelectedFile,
    selectedFiles,
    selectedFilesSummary,
    selectedUploadItems,
    sendFiles,
    sendingFiles,
    setFileCaption,
    setFileDialogOpen,
    setFileDragActive,
    setFileUploadProgress,
    setPreparingFiles,
    setSelectedUploadItems,
    setSendingFiles,
    startVoiceRecording,
    stopVoiceRecording,
    voiceRecording,
    voiceRecordingDuration,
    voiceRecordingLevelRef,
  };
}

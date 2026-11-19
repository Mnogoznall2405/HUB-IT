import { useCallback } from 'react';

import { canEditChatMessage } from '../../components/chat/chatHelpers';
import { restoreChatEditDraft, startChatMessageEditing } from '../../components/chat/useChatMessageMenuActions';

export function findLastEditableOwnMessage(messages) {
  const source = Array.isArray(messages) ? messages : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (canEditChatMessage(source[index])) return source[index];
  }
  return null;
}

export default function useChatComposerInteractionController({
  editingMessage = null,
  editDraftSnapshotRef = null,
  emojiPickerOpen = false,
  focusComposer,
  handleComposerSend,
  isMobile = false,
  latestDraftStorageKeyRef = null,
  latestMessageTextRef = null,
  messages = null,
  messagesHasNewer = false,
  replyMessage = null,
  selectedMessageCount = 0,
  setEditingMessage,
  setMessageText,
  setReplyMessage,
  voiceRecording = false,
}) {
  // ↑ в пустом композере — редактирование последнего своего сообщения (как в Telegram/Slack).
  const tryEditLastOwnMessage = useCallback((event) => {
    if (
      isMobile
      || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
      || editingMessage || replyMessage || emojiPickerOpen || voiceRecording
      || Number(selectedMessageCount || 0) > 0
      || messagesHasNewer
    ) {
      return false;
    }
    const target = event.currentTarget || event.target;
    const currentText = target && typeof target.value === 'string'
      ? target.value
      : String(latestMessageTextRef?.current ?? '');
    if (currentText.trim()) return false;
    if (target && Number.isFinite(target.selectionStart) && (target.selectionStart !== 0 || target.selectionEnd !== 0)) {
      return false;
    }
    const message = findLastEditableOwnMessage(messages);
    if (!message) return false;
    event.preventDefault();
    return startChatMessageEditing({
      message,
      focusComposer,
      setEditingMessage,
      setMessageText,
      setReplyMessage,
      editDraftSnapshotRef,
      latestDraftStorageKeyRef,
      latestMessageTextRef,
    });
  }, [
    editingMessage,
    editDraftSnapshotRef,
    emojiPickerOpen,
    focusComposer,
    isMobile,
    latestDraftStorageKeyRef,
    latestMessageTextRef,
    messages,
    messagesHasNewer,
    replyMessage,
    selectedMessageCount,
    setEditingMessage,
    setMessageText,
    setReplyMessage,
    voiceRecording,
  ]);

  const handleComposerKeyDown = useCallback((event) => {
    if (event.nativeEvent?.isComposing || event.isComposing) return;
    if (event.key === 'ArrowUp') {
      tryEditLastOwnMessage(event);
      return;
    }
    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.repeat
    ) {
      return;
    }
    event.preventDefault();
    void handleComposerSend();
  }, [handleComposerSend, tryEditLastOwnMessage]);

  const clearReplyMessage = useCallback(() => {
    setReplyMessage(null);
    focusComposer();
  }, [focusComposer, setReplyMessage]);

  const clearEditingMessage = useCallback(() => {
    setEditingMessage(null);
    if (!restoreChatEditDraft({ editDraftSnapshotRef, latestDraftStorageKeyRef, setMessageText })) {
      setMessageText('');
    }
    focusComposer();
  }, [editDraftSnapshotRef, focusComposer, latestDraftStorageKeyRef, setEditingMessage, setMessageText]);

  return {
    clearEditingMessage,
    clearReplyMessage,
    handleComposerKeyDown,
  };
}

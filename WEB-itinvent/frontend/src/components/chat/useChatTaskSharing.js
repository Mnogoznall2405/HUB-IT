import { useCallback } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatTaskSharing({
  activeConversationId,
  applyOutgoingThreadMessage,
  cancelPendingInitialAnchor,
  logChatDebug,
  notifyApiError,
  replyMessage,
  resetShareDialog,
  setReplyMessage,
  setSharingTaskId,
}) {
  const shareTask = useCallback(async (taskId) => {
    const conversationId = String(activeConversationId || '').trim();
    const normalizedTaskId = String(taskId || '').trim();
    if (!conversationId || !normalizedTaskId) return;
    setSharingTaskId(normalizedTaskId);
    try {
      const serverMessage = await chatAPI.shareTask(conversationId, normalizedTaskId, {
        reply_to_message_id: replyMessage?.id || undefined,
      });
      cancelPendingInitialAnchor();
      logChatDebug('shareTask:autoScroll', {
        conversationId,
      });
      setReplyMessage(null);
      resetShareDialog();
      if (serverMessage?.id) {
        applyOutgoingThreadMessage(conversationId, serverMessage, {
          scroll: true,
          scrollSource: 'shareTask',
        });
      }
    } catch (error) {
      notifyApiError(error, 'Не удалось отправить задачу в чат.');
    } finally {
      setSharingTaskId('');
    }
  }, [
    activeConversationId,
    applyOutgoingThreadMessage,
    cancelPendingInitialAnchor,
    logChatDebug,
    notifyApiError,
    replyMessage,
    resetShareDialog,
    setReplyMessage,
    setSharingTaskId,
  ]);

  return {
    shareTask,
  };
}

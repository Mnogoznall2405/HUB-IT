import { useEffect } from 'react';

import { chatAPI } from '../../api/client';

export default function useChatAiStatusPolling({
  activeConversationId,
  activeConversationKind,
  activeThreadTransportState,
  aiStatus,
  canUseAiChat,
  intervalMs,
  mergeAiStatusPayload,
  setAiStatusByConversation,
  shouldPollActiveAiThread,
  socketStatus,
}) {
  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!shouldPollActiveAiThread({
      activeConversationId: normalizedConversationId,
      activeConversationKind,
      aiStatus,
      canUseAiChat,
      transportState: activeThreadTransportState,
      socketStatus,
    })) {
      return undefined;
    }
    let cancelled = false;
    const pollOnce = () => {
      if (cancelled || !normalizedConversationId) return;
      void chatAPI.getConversationAiStatus(normalizedConversationId)
        .then((status) => {
          if (cancelled || !status || String(status?.conversation_id || '').trim() !== normalizedConversationId) return;
          setAiStatusByConversation((current) => mergeAiStatusPayload(current, status, normalizedConversationId));
        })
        .catch(() => {});
    };
    pollOnce();
    const intervalId = window.setInterval(pollOnce, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activeConversationId,
    activeConversationKind,
    activeThreadTransportState,
    aiStatus,
    canUseAiChat,
    intervalMs,
    mergeAiStatusPayload,
    setAiStatusByConversation,
    shouldPollActiveAiThread,
    socketStatus,
  ]);
}

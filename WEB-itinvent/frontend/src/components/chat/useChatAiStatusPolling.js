import { useEffect, useRef } from 'react';

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
  const aiStatusRef = useRef(aiStatus);
  aiStatusRef.current = aiStatus;

  const aiRunStatus = String(aiStatus?.status || '').trim();

  useEffect(() => {
    const normalizedConversationId = String(activeConversationId || '').trim();
    if (!shouldPollActiveAiThread({
      activeConversationId: normalizedConversationId,
      activeConversationKind,
      aiStatus: aiStatusRef.current,
      canUseAiChat,
      transportState: activeThreadTransportState,
      socketStatus,
    })) {
      return undefined;
    }

    let cancelled = false;
    let inFlight = false;

    const pollOnce = () => {
      if (cancelled || !normalizedConversationId || inFlight) return;
      if (!shouldPollActiveAiThread({
        activeConversationId: normalizedConversationId,
        activeConversationKind,
        aiStatus: aiStatusRef.current,
        canUseAiChat,
        transportState: activeThreadTransportState,
        socketStatus,
      })) {
        return;
      }

      inFlight = true;
      void chatAPI.getConversationAiStatus(normalizedConversationId)
        .then((status) => {
          if (cancelled || !status || String(status?.conversation_id || '').trim() !== normalizedConversationId) return;
          setAiStatusByConversation((current) => mergeAiStatusPayload(current, status, normalizedConversationId));
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
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
    aiRunStatus,
    canUseAiChat,
    intervalMs,
    mergeAiStatusPayload,
    setAiStatusByConversation,
    shouldPollActiveAiThread,
    socketStatus,
  ]);
}

import { useCallback, useMemo } from 'react';

import {
  AI_QUEUED_STATUS_TEXT,
  buildAiLiveDataNotice,
  buildAiStatusDisplayModel,
} from './chatAiModel';

export function resolveAiTypingStatus({
  activeConversationKind,
  activeAiStatus,
  activeAiStatusDisplay,
} = {}) {
  if (String(activeConversationKind || '').trim() !== 'ai') return null;
  if (activeAiStatusDisplay?.visible) return null;
  const status = String(activeAiStatus?.status || '').trim();
  const visible = status === 'queued' || status === 'running';
  if (!visible) return null;
  return {
    visible: true,
    botName: String(activeAiStatus?.bot_title || activeAiStatusDisplay?.primaryText || 'AI Ассистент').trim() || 'AI Ассистент',
  };
}

export default function useChatAiPresentation({
  activeConversationId,
  activeConversationKind,
  aiBots,
  aiStatusByConversation,
  setAiStatusByConversation,
}) {
  const activeAiStatus = useMemo(
    () => aiStatusByConversation[String(activeConversationId || '').trim()] || null,
    [activeConversationId, aiStatusByConversation],
  );

  const activeAiStatusDisplay = useMemo(
    () => buildAiStatusDisplayModel(activeAiStatus),
    [activeAiStatus],
  );

  const aiTypingStatus = useMemo(
    () => resolveAiTypingStatus({
      activeConversationKind,
      activeAiStatus,
      activeAiStatusDisplay,
    }),
    [activeAiStatus, activeAiStatusDisplay, activeConversationKind],
  );

  const activeAiLiveDataNotice = useMemo(
    () => buildAiLiveDataNotice({
      activeConversationKind,
      activeConversationId,
      aiStatus: activeAiStatus,
      aiBots,
    }),
    [activeAiStatus, activeConversationKind, activeConversationId, aiBots],
  );

  const setOptimisticAiQueuedStatus = useCallback((conversationId, botTitle = '') => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    setAiStatusByConversation((current) => ({
      ...(current && typeof current === 'object' ? current : {}),
      [normalizedConversationId]: {
        conversation_id: normalizedConversationId,
        bot_title: String(botTitle || '').trim() || null,
        status: 'queued',
        stage: 'queued',
        status_text: AI_QUEUED_STATUS_TEXT,
        error_text: null,
        updated_at: new Date().toISOString(),
      },
    }));
  }, [setAiStatusByConversation]);

  return {
    activeAiLiveDataNotice,
    activeAiStatus,
    activeAiStatusDisplay,
    aiTypingStatus,
    setOptimisticAiQueuedStatus,
  };
}

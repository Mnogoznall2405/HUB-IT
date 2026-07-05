import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';

export const canUseAiChatPermission = (hasPermission) => (
  typeof hasPermission === 'function' ? Boolean(hasPermission('chat.ai.use')) : false
);

export const shouldRequestConversationAiStatus = ({
  conversationId,
  conversationKind,
  canUseAiChat,
}) => (
  Boolean(canUseAiChat)
  && String(conversationId || '').trim().length > 0
  && String(conversationKind || '').trim() === 'ai'
);

export const mergeAiStatusPayload = (current, payload, fallbackConversationId = '') => {
  const nextCurrent = current && typeof current === 'object' ? current : {};
  const nextPayload = payload && typeof payload === 'object' ? payload : {};
  const conversationId = String(
    nextPayload.conversation_id
    || fallbackConversationId
    || ''
  ).trim();
  if (!conversationId) return nextCurrent;
  return {
    ...nextCurrent,
    [conversationId]: nextPayload,
  };
};

export const resolveActiveAiBotRecord = ({
  aiBots,
  activeConversationId,
  aiStatus,
}) => {
  const items = Array.isArray(aiBots) ? aiBots : [];
  const normalizedConversationId = String(activeConversationId || '').trim();
  const normalizedBotId = String(aiStatus?.bot_id || '').trim();
  return items.find((item) => String(item?.conversation_id || '').trim() === normalizedConversationId)
    || items.find((item) => normalizedBotId && String(item?.id || '').trim() === normalizedBotId)
    || null;
};

export const buildAiLiveDataNotice = ({
  activeConversationKind,
  activeConversationId,
  aiStatus,
  aiBots,
}) => {
  void activeConversationKind;
  void activeConversationId;
  void aiStatus;
  void aiBots;
  return null;
};

export const AI_QUEUED_STATUS_TEXT = 'Запрос принят. Ставлю задачу в очередь.';

const AI_STATUS_FALLBACK_TEXTS = {
  queued: AI_QUEUED_STATUS_TEXT,
  analyzing_request: 'Анализирую ваш запрос.',
  reading_files: 'Изучаю вложенные файлы и контекст.',
  retrieving_kb: 'Проверяю базу знаний и документы.',
  checking_itinvent: 'Проверяю данные ITinvent.',
  checking_ad: 'Проверяю данные Active Directory.',
  searching_equipment: 'Ищу оборудование.',
  opening_equipment_card: 'Открываю карточку устройства.',
  generating_answer: 'Формирую ответ.',
  generating_files: 'Подготавливаю итоговые файлы.',
  failed: 'Не удалось обработать запрос.',
};

export const buildAiStatusDisplayModel = (aiStatus) => {
  const payload = aiStatus && typeof aiStatus === 'object' ? aiStatus : {};
  const status = String(payload?.status || '').trim();
  const stage = String(payload?.stage || '').trim();
  const explicitText = String(payload?.status_text || '').trim();
  const fallbackText = explicitText
    || AI_STATUS_FALLBACK_TEXTS[stage]
    || AI_STATUS_FALLBACK_TEXTS[status]
    || '';
  const isVisible = Boolean(status) && status !== 'completed' && Boolean(fallbackText || status === 'failed');
  return {
    visible: isVisible,
    tone: status === 'failed' ? 'error' : 'info',
    primaryText: fallbackText,
    secondaryText: status === 'failed' ? String(payload?.error_text || '').trim() : '',
    showSpinner: status === 'queued' || status === 'running',
    status,
    stage,
  };
};

export const shouldPollActiveAiThread = ({
  activeConversationId,
  activeConversationKind,
  aiStatus,
  canUseAiChat,
  transportState = '',
  socketStatus,
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !conversationId || !canUseAiChat) return false;
  if (String(activeConversationKind || '').trim() !== 'ai') return false;
  const normalizedStatus = String(aiStatus?.status || '').trim();
  if (normalizedStatus === 'queued' || normalizedStatus === 'running') return true;
  const normalizedTransportState = String(transportState || '').trim();
  if (normalizedTransportState) return normalizedTransportState !== 'healthy';
  if (!chatWsEnabled) return false;
  return String(socketStatus || '').trim() !== 'connected';
};

export const buildAiSidebarRows = ({
  aiBots,
  conversations,
  draftsByConversation,
  activeConversationId,
}) => {
  const aiConversationById = new Map(
    (Array.isArray(conversations) ? conversations : [])
      .filter((item) => String(item?.kind || '').trim() === 'ai' && String(item?.id || '').trim())
      .map((item) => [String(item.id).trim(), item]),
  );
  const normalizedActiveConversationId = String(activeConversationId || '').trim();
  const drafts = draftsByConversation && typeof draftsByConversation === 'object' ? draftsByConversation : {};
  return (Array.isArray(aiBots) ? aiBots : []).map((bot) => {
    const conversationId = String(bot?.conversation_id || '').trim();
    const conversation = conversationId ? aiConversationById.get(conversationId) : null;
    return {
      ...bot,
      conversation_id: conversationId || '',
      title: String(conversation?.title || bot?.title || 'AI').trim() || 'AI',
      last_message_preview: String(conversation?.last_message_preview || '').trim(),
      last_message_at: conversation?.last_message_at || '',
      updated_at: conversation?.updated_at || '',
      unread_count: Number(conversation?.unread_count || 0),
      is_pinned: Boolean(conversation?.is_pinned),
      is_muted: Boolean(conversation?.is_muted),
      is_archived: Boolean(conversation?.is_archived),
      draft_preview: conversationId ? String(drafts[conversationId] || '').trim() : '',
      is_active: Boolean(conversationId && conversationId === normalizedActiveConversationId),
    };
  });
};

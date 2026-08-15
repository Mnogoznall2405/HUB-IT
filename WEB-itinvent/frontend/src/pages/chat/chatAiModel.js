import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
export { groupAiSidebarRowsByDate } from '../../components/chat/chatAiSidebarModel';

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
  const previous = nextCurrent[conversationId] && typeof nextCurrent[conversationId] === 'object'
    ? nextCurrent[conversationId]
    : {};
  const stage = String(nextPayload?.stage || '').trim();
  const completedStages = [
    ...(Array.isArray(previous?.completed_stages) ? previous.completed_stages : []),
    ...(stage && !['queued', 'completed', 'failed', 'cancelled'].includes(stage) ? [stage] : []),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const hasStageHistory = completedStages.length > 0 || Array.isArray(previous?.completed_stages);
  return {
    ...nextCurrent,
    [conversationId]: {
      ...previous,
      ...nextPayload,
      ...(hasStageHistory ? { completed_stages: completedStages } : {}),
    },
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
  return items.find((item) => (
    Array.isArray(item?.conversation_ids)
    && item.conversation_ids.some((id) => String(id || '').trim() === normalizedConversationId)
  ))
    || items.find((item) => String(item?.conversation_id || '').trim() === normalizedConversationId)
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

const RETIRED_AI_ASSISTANT_SLUGS = new Set(['it-helper']);
const RETIRED_AI_ASSISTANT_TITLES = new Set(['it-помощник', 'it помощник']);

const isRetiredAiConversation = (conversation, bot) => {
  const slug = String(bot?.slug || '').trim().toLowerCase();
  const title = String(conversation?.title || '').trim().toLocaleLowerCase('ru-RU');
  return RETIRED_AI_ASSISTANT_SLUGS.has(slug)
    || (!bot && RETIRED_AI_ASSISTANT_TITLES.has(title));
};

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
  converting_document: 'Распознаю документ и сохраняю структуру.',
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
  const agentByConversationId = new Map();
  (Array.isArray(aiBots) ? aiBots : []).forEach((bot) => {
    const conversationIds = [
      ...(Array.isArray(bot?.conversation_ids) ? bot.conversation_ids : []),
      bot?.conversation_id,
    ];
    conversationIds.forEach((value) => {
      const conversationId = String(value || '').trim();
      if (conversationId && !agentByConversationId.has(conversationId)) {
        agentByConversationId.set(conversationId, bot);
      }
    });
  });
  const normalizedActiveConversationId = String(activeConversationId || '').trim();
  const drafts = draftsByConversation && typeof draftsByConversation === 'object' ? draftsByConversation : {};
  return (Array.isArray(conversations) ? conversations : [])
    .filter((item) => String(item?.kind || '').trim() === 'ai' && String(item?.id || '').trim())
    .map((conversation) => {
      const conversationId = String(conversation.id).trim();
      const bot = agentByConversationId.get(conversationId) || null;
      if (isRetiredAiConversation(conversation, bot)) return null;
      return {
        ...(bot || {}),
        bot_id: String(bot?.id || '').trim(),
        conversation_id: conversationId,
        title: String(conversation?.title || bot?.title || 'AI').trim() || 'AI',
        assistant_title: String(bot?.title || '').trim() || 'Личный AI',
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
    })
    .filter(Boolean);
};

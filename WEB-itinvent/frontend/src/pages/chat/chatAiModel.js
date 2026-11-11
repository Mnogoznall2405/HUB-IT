import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
export { groupAiSidebarRowsByDate } from '../../components/chat/chatAiSidebarModel';
export { resolveActiveAiBotRecord } from '../../components/chat/chatHelpers';

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
  const incomingRun = String(nextPayload.run_id || '').trim();
  const previousRun = String(previous.run_id || '').trim();
  const newRun = Boolean(incomingRun && previousRun && incomingRun !== previousRun);
  const previousTime = Date.parse(previous.updated_at || '');
  const nextTime = Date.parse(nextPayload.updated_at || '');
  const previousCreated = Date.parse(previous.run_created_at || '');
  const nextCreated = Date.parse(nextPayload.run_created_at || '');
  const terminal = ['completed', 'failed', 'cancelled'];
  if ((incomingRun && previous._previous_run_ids?.includes(incomingRun))
    || (newRun && Number.isFinite(previousCreated) && Number.isFinite(nextCreated) && nextCreated < previousCreated)
    || (previousRun && incomingRun && Number.isFinite(previousTime) && Number.isFinite(nextTime) && nextTime < previousTime)
    || (!newRun && terminal.includes(previous.status) && ['queued', 'running'].includes(nextPayload.status))) {
    return nextCurrent;
  }
  const base = newRun ? {} : previous;
  const stage = String(nextPayload?.stage || '').trim();
  const previousStage = String(base.stage || '').trim();
  const completedPrevious = previousStage && previousStage !== stage
    && !['queued', 'completed', 'failed', 'cancelled'].includes(previousStage)
    && (nextPayload.status === 'completed' || ['running', 'queued'].includes(nextPayload.status));
  const completedStages = [
    ...(Array.isArray(base.completed_stages) ? base.completed_stages : []),
    ...(Array.isArray(nextPayload.completed_stages) ? nextPayload.completed_stages : []),
    ...(completedPrevious ? [previousStage] : []),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const hasStageHistory = newRun || completedStages.length > 0 || Array.isArray(base.completed_stages);
  // Шаги инструментов («Думает»): событие несёт один шаг, копим по id и обновляем на месте.
  const { step: incomingStep, ...payloadWithoutStep } = nextPayload;
  const steps = Array.isArray(base.steps) ? [...base.steps] : [];
  if (incomingStep && typeof incomingStep === 'object' && incomingStep.id) {
    const index = steps.findIndex((item) => item.id === incomingStep.id);
    if (index >= 0) steps[index] = { ...steps[index], ...incomingStep };
    else steps.push(incomingStep);
  }
  return {
    ...nextCurrent,
    [conversationId]: {
      ...base,
      ...payloadWithoutStep,
      ...(steps.length ? { steps: steps.slice(-20) } : {}),
      ...(hasStageHistory ? { completed_stages: completedStages } : {}),
      ...(newRun ? { _previous_run_ids: [...(previous._previous_run_ids || []), previousRun].slice(-16) } : {}),
    },
  };
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
  const resultReady = status === 'running' && Boolean(payload.result_message_id)
    && ['generating_answer', 'result_ready'].includes(stage);
  const fallbackText = resultReady ? 'Ответ готов. Завершаю обработку.' : explicitText
    || AI_STATUS_FALLBACK_TEXTS[stage]
    || AI_STATUS_FALLBACK_TEXTS[status]
    || '';
  const isVisible = Boolean(status) && status !== 'completed' && Boolean(fallbackText || status === 'failed');
  return {
    visible: isVisible,
    tone: status === 'failed' ? 'error' : 'info',
    primaryText: fallbackText,
    secondaryText: status === 'failed' ? String(payload?.error_text || '').trim() : '',
    showSpinner: (status === 'queued' || status === 'running') && !resultReady,
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
  const agentByBotId = new Map();
  (Array.isArray(aiBots) ? aiBots : []).forEach((bot) => {
    const botId = String(bot?.id || '').trim();
    if (botId) agentByBotId.set(botId, bot);
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
      // AI8: prefer the server-side conversation→bot field so a row keeps its
      // assistant even when the bot is disabled or absent from list_bots.
      const serverBotId = String(conversation?.ai_bot_id || conversation?.bot_id || '').trim();
      const bot = (serverBotId ? agentByBotId.get(serverBotId) : null)
        || agentByConversationId.get(conversationId)
        || null;
      if (isRetiredAiConversation(conversation, bot)) return null;
      return {
        ...(bot || {}),
        bot_id: String(bot?.id || '').trim(),
        conversation_id: conversationId,
        title: String(conversation?.title || bot?.title || 'AI').trim() || 'AI',
        assistant_title: String(bot?.title || '').trim() || 'HUB Ассистент',
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

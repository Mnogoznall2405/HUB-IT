import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';
import { getLatestPersistedThreadMessageId } from './chatThreadMessages';

export const ACTIVE_THREAD_SOCKET_STALE_MS = 60_000;
export const ACTIVE_THREAD_REVALIDATE_DEDUP_MS = 2_500;

export const resolveActiveThreadTransportState = ({
  activeConversationId,
  socketStatus,
  lastSocketActivityAt = 0,
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
  staleAfterMs = ACTIVE_THREAD_SOCKET_STALE_MS,
  now = Date.now(),
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !chatWsEnabled || !conversationId) return 'offline';
  const normalizedSocketStatus = String(socketStatus || '').trim();
  if (normalizedSocketStatus === 'connected') {
    const activityAt = Number(lastSocketActivityAt || 0);
    if (!Number.isFinite(activityAt) || activityAt <= 0) return 'degraded';
    return (Number(now) - activityAt) <= Number(staleAfterMs || ACTIVE_THREAD_SOCKET_STALE_MS) ? 'healthy' : 'degraded';
  }
  if (normalizedSocketStatus === 'connecting' || normalizedSocketStatus === 'reconnecting') return 'degraded';
  return 'offline';
};

export const shouldPollActiveThreadIncrementally = ({
  activeConversationId,
  transportState = '',
  chatWsEnabled = CHAT_WS_ENABLED,
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
}) => {
  const conversationId = String(activeConversationId || '').trim();
  if (!chatFeatureEnabled || !chatWsEnabled || !conversationId) return false;
  return String(transportState || '').trim() !== 'healthy';
};

export const shouldSkipActiveThreadRevalidate = ({
  activeConversationId,
  conversationId,
  reason = '',
  messages = [],
  latestSocketMessage = null,
  now = Date.now(),
  dedupeMs = ACTIVE_THREAD_REVALIDATE_DEDUP_MS,
} = {}) => {
  const activeId = String(activeConversationId || '').trim();
  const targetId = String(conversationId || '').trim();
  if (!activeId || !targetId || activeId !== targetId) return false;

  const normalizedReason = String(reason || '').trim();
  const canDedupeReason = normalizedReason === 'message_created'
    || normalizedReason === 'message_updated'
    || normalizedReason === 'created'
    || normalizedReason === 'updated'
    || normalizedReason === 'ai_run_completed'
    || normalizedReason === 'ai_run_failed';
  if (!canDedupeReason) return false;

  const socketConversationId = String(latestSocketMessage?.conversationId || '').trim();
  const socketMessageId = String(latestSocketMessage?.messageId || '').trim();
  const socketAt = Number(latestSocketMessage?.at || 0);
  if (!socketConversationId || socketConversationId !== targetId || !socketMessageId) return false;
  if (!Number.isFinite(socketAt) || socketAt <= 0) return false;
  if ((Number(now || Date.now()) - socketAt) > Number(dedupeMs || 0)) return false;

  return (Array.isArray(messages) ? messages : []).some((message) => (
    !message?.isOptimistic
    && String(message?.id || '').trim() === socketMessageId
  ));
};

export const buildCursorInvalidThreadReloadOptions = (reason = 'thread') => ({
  silent: true,
  force: true,
  reason: `${String(reason || '').trim() || 'thread'}:cursor-invalid`,
});

export const buildActiveThreadPollLoadOptions = (messagesOrLastMessageId) => {
  const normalizedLastMessageId = Array.isArray(messagesOrLastMessageId)
    ? getLatestPersistedThreadMessageId(messagesOrLastMessageId)
    : String(messagesOrLastMessageId || '').trim();
  if (normalizedLastMessageId) {
    return {
      silent: true,
      afterMessageId: normalizedLastMessageId,
      reason: 'poll:active-thread:newer',
    };
  }
  return {
    silent: true,
    reason: 'poll:active-thread:bootstrap',
    force: true,
  };
};

export const isTransientLoadMessagesError = (error) => {
  const status = Number(error?.response?.status || 0);
  return status === 0 || status === 502 || status === 503 || status === 504;
};

export const isBackgroundLoadMessagesReason = (reason) => {
  const normalizedReason = String(reason || '').trim().toLowerCase();
  return normalizedReason.startsWith('poll:')
    || normalizedReason.includes(':revalidate')
    || normalizedReason.startsWith('window:')
    || normalizedReason.startsWith('socket:');
};

export const shouldNotifyLoadMessagesError = ({
  silent = false,
  reason = '',
  error = null,
  loadingOlderRequest = false,
  loadingNewerRequest = false,
} = {}) => {
  const code = String(error?.code || '');
  const name = String(error?.name || '');
  if (code === 'ERR_CANCELED' || name === 'CanceledError') return false;
  if (!silent) return true;
  if (isBackgroundLoadMessagesReason(reason)) return false;
  if (isTransientLoadMessagesError(error)) return false;
  return Boolean(loadingOlderRequest || loadingNewerRequest);
};

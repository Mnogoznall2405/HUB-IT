import { createNavigateToastAction } from '../components/feedback/toastActions';
import {
  buildChatNotificationRoute,
  resolveChatNotificationSenderName,
  shouldDeliverExternalChatViaPushOnly,
} from './chatNotifications';
import { getMessagePreview } from '../components/chat/chatHelpers';

const PUSH_TOAST_DURATION_MS = 5200;

/**
 * План реакции на CHAT_SOCKET_MESSAGE_CREATED.
 * Чистая функция: claim и побочные эффекты остаются в вызывающем коде.
 * kind:
 * - 'ignore'    — пустой envelope, нет id, собственное сообщение;
 * - 'suppress'  — чат muted и нет mention (claim не нужен);
 * - 'plan'      — нужен claim messageId, затем suppress/toast/system по полям.
 */
export function resolveChatMessageNotificationPlan(envelope = {}, context = {}) {
  const message = envelope?.payload || {};
  const conversationId = String(envelope?.conversation_id || message?.conversation_id || '').trim();
  const messageId = String(message?.id || '').trim();
  if (!messageId || !conversationId || Boolean(message?.is_own)) {
    return { kind: 'ignore' };
  }

  const currentUserId = Number(context.userId || 0);
  const isCurrentUserMentioned = (
    currentUserId > 0
    && Array.isArray(message?.mentioned_user_ids)
    && message.mentioned_user_ids.some((item) => Number(item) === currentUserId)
  );
  if (context.isConversationMuted && !isCurrentUserMentioned) {
    return { kind: 'suppress', reason: 'conversation_muted' };
  }

  const isVisible = Boolean(context.isVisible);
  const isActiveVisibleConversation = (
    (context.isChatRoute || context.isTaskDiscussionRoute)
    && context.activeChatConversationId === conversationId
    && isVisible
  );
  const suppress = isActiveVisibleConversation
    ? 'active_visible_conversation'
    : context.isMobileChatRoute && isVisible
      ? 'mobile_chat_route_visible'
      : !context.chatChannelEnabled
        ? 'notifications_disabled'
        : null;

  const plan = {
    kind: 'plan',
    messageId,
    conversationId,
    suppress,
    toast: null,
    system: null,
    reason: null,
    shouldShowLocalSystemNotification: false,
    isActiveVisibleConversation,
  };
  if (suppress) return plan;

  const previewText = getMessagePreview(message);
  const senderName = resolveChatNotificationSenderName(message);
  const navigateTo = buildChatNotificationRoute({
    conversationId,
    messageId,
    conversationKind: message?.conversation_kind,
    taskId: message?.task_id,
  });

  if (isVisible) {
    plan.toast = {
      body: previewText,
      options: {
        title: senderName,
        source: 'chat',
        channel: 'system',
        dedupeMode: 'recent',
        dedupeKey: `chat:${messageId}`,
        action: createNavigateToastAction(navigateTo, 'Открыть чат'),
        durationMs: PUSH_TOAST_DURATION_MS,
      },
    };
  }

  const chatNotificationState = context.chatNotificationState || {};
  if (chatNotificationState.permission !== 'granted') {
    plan.reason = 'permission_not_granted';
    return plan;
  }
  const shouldShowLocalSystemNotification = (
    !isVisible
    && !shouldDeliverExternalChatViaPushOnly(chatNotificationState)
  );
  plan.shouldShowLocalSystemNotification = shouldShowLocalSystemNotification;
  if (shouldShowLocalSystemNotification) {
    plan.system = {
      messageId,
      title: senderName,
      body: previewText,
      conversationId,
      conversationKind: message?.conversation_kind,
      taskId: message?.task_id,
      navigateTo,
    };
  }
  return plan;
}

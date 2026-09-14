import { createNavigateToastAction } from '../components/feedback/toastActions';
import { buildChatNotificationRoute } from './chatNotifications';

const PUSH_TOAST_DURATION_MS = 5200;

/**
 * Решение, что делать с foreground push-уведомлением:
 * - suppress — уже видимый чат/маршрут или живой socket;
 * - claim-chat — нужно зарезервировать messageId перед показом;
 * - toast — показать тост с этим payload.
 * Функция чистая: решение снаружи, побочные эффекты (claim/notify) в вызывающем.
 */
export function resolveForegroundPushDecision(detail = {}, context = {}) {
  const channel = String(detail?.channel || '').trim().toLowerCase() || 'system';
  const data = detail?.data && typeof detail.data === 'object' ? detail.data : {};
  const route = String(detail?.route || data?.route || '/').trim() || '/';
  const title = String(detail?.title || '').trim();
  const body = String(detail?.body || '').trim();

  if (channel === 'chat') {
    const conversationId = String(data?.conversation_id || '').trim();
    const messageId = String(data?.message_id || '').trim();
    const conversationKind = String(data?.conversation_kind || '').trim();
    const taskId = String(data?.task_id || '').trim();
    const pushTag = String(detail?.tag || '').trim();

    if (context.skipChatPush) {
      return { kind: 'suppress', reason: 'chat_socket_connected' };
    }
    const navigateTo = route !== '/'
      ? route
      : buildChatNotificationRoute({ conversationId, messageId, conversationKind, taskId });
    if (context.isMobileChatRoute && context.isVisible) {
      return { kind: 'suppress', reason: 'mobile_chat_route_visible' };
    }
    const isActiveVisibleConversation = (
      (context.isChatRoute || context.isTaskDiscussionRoute)
      && context.activeChatConversationId === conversationId
      && context.isVisible
    );
    if (isActiveVisibleConversation) {
      return { kind: 'suppress', reason: 'active_visible_conversation' };
    }
    return {
      kind: 'claim-chat',
      messageId,
      body: body || title || 'Новое сообщение',
      options: {
        title: title || 'Собеседник',
        source: 'chat',
        channel: 'system',
        dedupeMode: 'recent',
        dedupeKey: `chat:${messageId || pushTag || conversationId}`,
        action: createNavigateToastAction(navigateTo, 'Открыть чат'),
        durationMs: PUSH_TOAST_DURATION_MS,
      },
    };
  }

  if (channel === 'mail') {
    const messageId = String(data?.message_id || '').trim();
    return {
      kind: 'toast',
      body: body || title || 'Новое письмо',
      options: {
        title: title || 'Почта',
        source: 'mail',
        channel: 'system',
        dedupeMode: 'recent',
        dedupeKey: `mail:${messageId || String(detail?.tag || '').trim() || route}`,
        action: createNavigateToastAction(route, 'Открыть письмо'),
        durationMs: PUSH_TOAST_DURATION_MS,
      },
    };
  }

  const notificationId = String(data?.notification_id || '').trim();
  const actionLabel = channel === 'tasks'
    ? 'Открыть задачу'
    : channel === 'announcements'
      ? 'Открыть публикацию'
      : 'Открыть';
  return {
    kind: 'toast',
    body: body || title || 'Новое уведомление',
    options: {
      title: title || 'Уведомление',
      source: 'hub',
      channel: 'system',
      dedupeMode: 'recent',
      dedupeKey: `hub:${notificationId || String(detail?.tag || '').trim() || route}`,
      action: createNavigateToastAction(route, actionLabel),
      durationMs: PUSH_TOAST_DURATION_MS,
    },
  };
}

/** Куда доставить уведомление о пришедшем письме: 'toast' | 'system' | 'suppress'. */
export function resolveMailArrivalDelivery({ isVisible, pushSubscribed, backgroundCapable, windowsState } = {}) {
  if (isVisible) return 'toast';
  if (pushSubscribed && backgroundCapable) return 'suppress';
  if (windowsState?.enabled && windowsState?.permission === 'granted') return 'system';
  return 'suppress';
}

/** Чистая часть карточки mail-уведомления: id, роут и тексты. */
export function buildMailArrivalToastPayload(item = {}, { notificationId, title, body } = {}) {
  const messageId = String(item?.id || '').trim();
  if (!messageId || !notificationId) return null;
  const routeParts = [
    `folder=${encodeURIComponent(String(item?.folder || 'inbox'))}`,
    `message=${encodeURIComponent(messageId)}`,
  ];
  const mailboxId = String(item?.mailbox_id || '').trim();
  if (mailboxId) routeParts.push(`mailbox_id=${encodeURIComponent(mailboxId)}`);
  const route = `/mail?${routeParts.join('&')}`;
  return {
    messageId,
    route,
    title,
    body,
    toastOptions: {
      title,
      source: 'mail',
      channel: 'mail',
      action: createNavigateToastAction(route, 'Открыть письмо'),
      dedupeMode: 'recent',
      dedupeKey: `mail:${notificationId}`,
      durationMs: PUSH_TOAST_DURATION_MS,
    },
  };
}

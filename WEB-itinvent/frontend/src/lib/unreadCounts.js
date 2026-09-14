import { createNavigateToastAction } from '../components/feedback/toastActions';

/** Разбор payload /hub/notifications/unread-counts в поля счётчиков. */
export function parseHubUnreadCounts(data = {}) {
  const counts = data || {};
  return {
    notificationsUnreadTotal: Number(counts.notifications_unread_total || 0),
    announcementsUnread: Number(counts.announcements_unread || 0),
    announcementsAckPending: Number(counts.announcements_ack_pending || 0),
    tasksOpenTotal: Number(counts.tasks_open_total || counts.tasks_open || 0),
    tasksOpen: Number(counts.tasks_open || counts.tasks_open_total || 0),
    tasksNew: Number(counts.tasks_new || 0),
    tasksAssigneeOpen: Number(counts.tasks_assignee_open || 0),
    tasksCreatedOpen: Number(counts.tasks_created_open || 0),
    tasksControllerOpen: Number(counts.tasks_controller_open || 0),
    tasksReviewRequired: Number(counts.tasks_review_required || 0),
    tasksOverdue: Number(counts.tasks_overdue || 0),
    tasksWithUnreadComments: Number(counts.tasks_with_unread_comments || 0),
    hubChatOrdinary: counts.hub_chat_ordinary || null,
  };
}

/**
 * Итоговое состояние mail-счётчика после ответа API.
 * Гонка мутаций (mark-read во время полёта) и state 'unknown/error'
 * сохраняют предыдущее значение.
 */
export function resolveMailUnreadResult({ data, previousCounts, mutationRaced, currentCounts } = {}) {
  if (mutationRaced) {
    const counts = currentCounts || {};
    return {
      mailUnread: Number(counts.mail_unread || 0),
      mailState: String(counts.mail_state || 'unknown'),
      mailAsOf: counts.mail_as_of || null,
    };
  }
  const nextState = String(data?.state || 'ok');
  const prev = previousCounts || {};
  return {
    mailUnread: ['unknown', 'error'].includes(nextState) && !data?.as_of
      ? Number(prev.mail_unread || 0)
      : Number(data?.unread_count || 0),
    mailState: nextState,
    mailAsOf: data?.as_of || null,
  };
}

/** Сборка итогового объекта счётчиков из частичных результатов. */
export function buildNextUnreadCounts({ hub = {}, mail = {}, chat = {}, previousCounts = {}, chatWsEnabled = false } = {}) {
  const prev = previousCounts || {};
  const mailUnread = Number(mail.unread || 0);
  return {
    notifications_unread_total: Number(hub.notificationsUnreadTotal || 0) + mailUnread,
    announcements_unread: Number(hub.announcementsUnread || 0),
    announcements_ack_pending: Number(hub.announcementsAckPending || 0),
    tasks_open_total: Number(hub.tasksOpenTotal || 0),
    tasks_open: Number(hub.tasksOpen || 0),
    tasks_new: Number(hub.tasksNew || 0),
    tasks_assignee_open: Number(hub.tasksAssigneeOpen || 0),
    tasks_created_open: Number(hub.tasksCreatedOpen || 0),
    tasks_controller_open: Number(hub.tasksControllerOpen || 0),
    tasks_review_required: Number(hub.tasksReviewRequired || 0),
    tasks_overdue: Number(hub.tasksOverdue || 0),
    tasks_with_unread_comments: Number(hub.tasksWithUnreadComments || 0),
    chat_messages_unread_total: chatWsEnabled
      ? Number(prev.chat_messages_unread_total || 0)
      : Number(chat.messagesUnreadTotal || 0),
    chat_conversations_unread: chatWsEnabled
      ? Number(prev.chat_conversations_unread || 0)
      : Number(chat.conversationsUnread || 0),
    mail_unread: mailUnread,
    mail_state: mail.state || 'unknown',
    mail_as_of: mail.asOf || null,
  };
}

/** Должен ли рост mail-unread триггерить уведомления (baseline уже был). */
export function shouldNotifyMailArrival({ resolved, hadBaseline, nextUnread, previousUnread } = {}) {
  return Boolean(resolved && hadBaseline && nextUnread > previousUnread);
}

/** Локальная дельта mail-unread (mark-read и т.п.) без обращения к API. */
export function applyMailUnreadDeltaToCounts(previousCounts, unreadDelta) {
  const delta = Number(unreadDelta || 0);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const prev = previousCounts || {};
  const previousMailUnread = Math.max(0, Number(prev.mail_unread || 0));
  const nextMailUnread = Math.max(0, previousMailUnread + delta);
  const hubUnread = Math.max(0, Number(prev.notifications_unread_total || 0) - previousMailUnread);
  return {
    nextMailUnread,
    nextCounts: {
      ...prev,
      notifications_unread_total: hubUnread + nextMailUnread,
      mail_unread: nextMailUnread,
    },
  };
}

/** Тост роста непрочитанного чата для не-WS fallback. null — показывать не надо. */
export function resolveChatUnreadDeltaToast({
  chatMessagesUnreadTotal,
  previousChatMessagesUnread,
  hadBaseline,
  isVisible,
  isOnChatRoute,
} = {}) {
  if (!hadBaseline) return { baselineOnly: true };
  const delta = Number(chatMessagesUnreadTotal || 0) - Number(previousChatMessagesUnread || 0);
  if (delta <= 0) return null;
  if (!isVisible || isOnChatRoute) return null;
  const message = delta === 1
    ? 'Новое сообщение в чате'
    : `Новые сообщения в чате: ${delta}`;
  return {
    baselineOnly: false,
    message,
    options: {
      title: 'Чат',
      source: 'chat',
      channel: 'system',
      dedupeMode: 'recent',
      dedupeKey: `chat-unread-delta:${Number(chatMessagesUnreadTotal || 0)}`,
      action: createNavigateToastAction('/chat', 'Открыть чат'),
      durationMs: 5200,
    },
  };
}

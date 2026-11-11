import { filterHubBellNotifications } from './chatNotifications';

const sortDescBy = (items, key) => items
  .sort((left, right) => String(right?.[key] || '').localeCompare(String(left?.[key] || '')));

/** Hub-ветка колокольчика: только unread=1, доменный фильтр, новые сверху. */
export function selectHubBellItems(response, { ordinaryReadVisible } = {}) {
  const items = (Array.isArray(response?.data?.items) ? response.data.items : [])
    .filter((item) => Number(item?.unread || 0) === 1);
  return sortDescBy(filterHubBellNotifications(items, { ordinaryReadVisible }), 'created_at');
}

/** Mail-ветка колокольчика: непрочитанные, новые сверху. */
export function selectMailBellItems(data) {
  const items = (Array.isArray(data?.items) ? data.items : [])
    .filter((item) => !item?.is_read);
  return sortDescBy(items, 'received_at');
}

/**
 * Оставляет ли элемент в списке после mark-read события.
 * mode 'conversations' фильтрует по conversation_id, иначе по id/message_id.
 */
export function shouldKeepMailNotificationAfterRead(item, { targetId, mode } = {}) {
  const target = String(targetId || '').trim();
  if (!target) return true;
  if (String(mode || 'messages').trim() === 'conversations') {
    return String(item?.conversation_id || '').trim() !== target;
  }
  return String(item?.id || item?.message_id || '').trim() !== target;
}

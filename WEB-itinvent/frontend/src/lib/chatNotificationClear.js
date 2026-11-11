import {
  clearDesktopNotificationGroup,
  isValidDesktopNotificationGroup,
} from './desktopBridge';

// "One notification per chat": the newest chat message replaces the previous
// notification of the same conversation, and opening the chat removes them.
export const CHAT_CONVERSATION_NOTIFICATION_TAG_PREFIX = 'chat:conv:';
export const CHAT_CLEAR_CONVERSATION_NOTIFICATIONS_MESSAGE_TYPE = 'itinvent:chat-clear-conversation-notifications';
export const CHAT_NOTIFICATION_CLEAR_THROTTLE_MS = 2_000;

const MAXIMUM_TRACKED_CONVERSATIONS = 200;
const lastClearAtByConversation = new Map();
const localNotificationsByConversation = new Map();

function normalizeId(value) {
  return String(value ?? '').trim();
}

export function buildChatConversationNotificationTag(conversationId) {
  const normalizedConversationId = normalizeId(conversationId);
  return normalizedConversationId
    ? `${CHAT_CONVERSATION_NOTIFICATION_TAG_PREFIX}${normalizedConversationId}`
    : '';
}

/**
 * Desktop host groups: task discussions are grouped by `task:<taskId>` (their
 * route points to the task), ordinary chats by `chat:<conversationId>`.
 * Values the host would reject (over 64 chars, unsafe characters) are dropped.
 */
export function buildChatNotificationDesktopGroups({ conversationId, taskId } = {}) {
  const groups = [];
  const normalizedTaskId = normalizeId(taskId);
  const normalizedConversationId = normalizeId(conversationId);
  if (normalizedTaskId) groups.push(`task:${normalizedTaskId}`);
  if (normalizedConversationId) groups.push(`chat:${normalizedConversationId}`);
  return groups.filter((group) => isValidDesktopNotificationGroup(group));
}

function trimTrackedMap(map) {
  while (map.size > MAXIMUM_TRACKED_CONVERSATIONS) {
    const [oldestKey] = map.keys();
    map.delete(oldestKey);
  }
}

export function rememberChatConversationNotification(conversationId, notification) {
  const normalizedConversationId = normalizeId(conversationId);
  if (!normalizedConversationId || !notification || typeof notification.close !== 'function') return;
  const entries = localNotificationsByConversation.get(normalizedConversationId) || new Set();
  entries.add(notification);
  localNotificationsByConversation.delete(normalizedConversationId);
  localNotificationsByConversation.set(normalizedConversationId, entries);
  trimTrackedMap(localNotificationsByConversation);
}

function closeLocalConversationNotifications(conversationId) {
  const entries = localNotificationsByConversation.get(conversationId);
  if (!entries) return;
  localNotificationsByConversation.delete(conversationId);
  entries.forEach((notification) => {
    try {
      notification.close();
    } catch {
      // Closing a notification is best-effort.
    }
  });
}

function postClearToServiceWorker(conversationId) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  const message = {
    type: CHAT_CLEAR_CONVERSATION_NOTIFICATIONS_MESSAGE_TYPE,
    conversation_id: conversationId,
  };
  const controller = navigator.serviceWorker.controller;
  try {
    controller?.postMessage?.(message);
  } catch {
    // Service worker messaging is best-effort.
  }
  if (controller || typeof navigator.serviceWorker.getRegistration !== 'function') return;
  // Not controlled yet (first load): reach the active worker without waiting
  // for `ready`, which never settles when no worker is registered.
  Promise.resolve()
    .then(() => navigator.serviceWorker.getRegistration())
    .then((registration) => registration?.active?.postMessage?.(message))
    .catch(() => {
      // No service worker: nothing to clear.
    });
}

/**
 * Removes notifications of a chat the user is actually looking at: service
 * worker push notifications, page-created Notification objects and, on the
 * desktop host that supports it, the native notification group.
 * Throttled to one call per conversation per CHAT_NOTIFICATION_CLEAR_THROTTLE_MS.
 */
export function clearChatConversationNotifications(conversationId, { taskId = '', now = Date.now() } = {}) {
  const normalizedConversationId = normalizeId(conversationId);
  if (!normalizedConversationId) return false;
  const lastClearAt = lastClearAtByConversation.get(normalizedConversationId);
  if (lastClearAt !== undefined && now - lastClearAt < CHAT_NOTIFICATION_CLEAR_THROTTLE_MS) return false;
  lastClearAtByConversation.delete(normalizedConversationId);
  lastClearAtByConversation.set(normalizedConversationId, now);
  trimTrackedMap(lastClearAtByConversation);

  postClearToServiceWorker(normalizedConversationId);
  closeLocalConversationNotifications(normalizedConversationId);
  buildChatNotificationDesktopGroups({ conversationId: normalizedConversationId, taskId })
    .forEach((group) => {
      clearDesktopNotificationGroup(group);
    });
  return true;
}

export function resetChatNotificationClearStateForTests() {
  lastClearAtByConversation.clear();
  localNotificationsByConversation.clear();
}

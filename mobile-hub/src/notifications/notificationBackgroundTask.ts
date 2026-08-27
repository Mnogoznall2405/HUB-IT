import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import * as tokenStore from '../auth/tokenStore';
import { queueConversationRead, isRetryableOfflineError } from '../offline/offlineCommandQueue';
import {
  dismissHandledNotification,
  getNotificationActionDetails,
  processNotificationAction,
} from './notificationActions';
import { showReplyFailed, showReplyPending, showReplySent } from './notificationActionFeedback';
import { reconcileNativeBadge } from './notificationBadge';
import { notificationData } from './notificationNavigation';
import {
  HUBIT_CHAT_MARK_READ_ACTION,
  HUBIT_CHAT_REPLY_ACTION,
  HUBIT_CHAT_RETRY_REPLY_ACTION,
  HUBIT_MAIL_MARK_READ_ACTION,
} from './nativePush';
import {
  queuePendingChatReply,
  retryPendingChatReply,
  type PendingChatReply,
} from './pendingNotificationReplies';

export const HUBIT_NOTIFICATION_BACKGROUND_TASK = 'hubit-notification-actions-v1';

async function finishHandledAction(
  result: Notifications.BackgroundNotificationTaskResult,
): Promise<Notifications.BackgroundNotificationTaskResult> {
  await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  return result;
}

function isNotificationResponse(
  data: Notifications.NotificationTaskPayload,
): data is Notifications.NotificationResponse {
  return Boolean(data && typeof data === 'object' && 'actionIdentifier' in data && 'notification' in data);
}

async function pendingReplyFromResponse(
  response: Notifications.NotificationResponse,
  userId: number,
): Promise<PendingChatReply> {
  const details = await getNotificationActionDetails(response);
  return {
    id: details.clientMessageId,
    userId,
    conversationId: details.conversationId,
    messageId: details.messageId,
    body: details.body,
    notificationId: details.notificationId,
    route: details.route,
    createdAt: Date.now(),
    attempts: 0,
  };
}

export async function handleNotificationBackgroundTask(
  data: Notifications.NotificationTaskPayload,
  taskError?: unknown,
): Promise<Notifications.BackgroundNotificationTaskResult> {
  if (taskError) return Notifications.BackgroundNotificationTaskResult.Failed;
  if (!isNotificationResponse(data)) {
    await reconcileNativeBadge().catch(() => undefined);
    return Notifications.BackgroundNotificationTaskResult.NewData;
  }

  const action = String(data.actionIdentifier || '').trim();
  const userId = await tokenStore.getSessionUserId();
  const recipientUserId = Number(notificationData(data).recipient_user_id || 0);

  if (action === HUBIT_CHAT_RETRY_REPLY_ACTION) {
    if (!userId || (recipientUserId > 0 && recipientUserId !== userId)) {
      return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
    }
    const pendingId = String(notificationData(data).pending_action_id || '').trim();
    if (!pendingId) return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
    const result = await retryPendingChatReply(pendingId, userId);
    if (result.status === 'sent' && result.item) await showReplySent(result.item);
    else if (result.status === 'pending' && result.item) await showReplyPending(result.item);
    else if (result.item) await showReplyFailed(result.item);
    await reconcileNativeBadge().catch(() => undefined);
    return finishHandledAction(result.status === 'discarded'
      ? Notifications.BackgroundNotificationTaskResult.Failed
      : Notifications.BackgroundNotificationTaskResult.NewData);
  }

  if (
    action !== HUBIT_CHAT_REPLY_ACTION
    && action !== HUBIT_CHAT_MARK_READ_ACTION
    && action !== HUBIT_MAIL_MARK_READ_ACTION
  ) {
    return Notifications.BackgroundNotificationTaskResult.NoData;
  }
  if (!userId || (recipientUserId > 0 && recipientUserId !== userId)) {
    return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
  }

  try {
    await processNotificationAction(data);
    if (action === HUBIT_CHAT_REPLY_ACTION && userId) {
      await showReplySent(await pendingReplyFromResponse(data, userId));
    }
    await reconcileNativeBadge().catch(() => undefined);
    return finishHandledAction(Notifications.BackgroundNotificationTaskResult.NewData);
  } catch (error) {
    if (action === HUBIT_MAIL_MARK_READ_ACTION) {
      return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
    }
    if (!isRetryableOfflineError(error) || !userId) {
      if (action === HUBIT_CHAT_REPLY_ACTION && userId) {
        await showReplyFailed(await pendingReplyFromResponse(data, userId));
      }
      return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
    }

    if (action === HUBIT_CHAT_MARK_READ_ACTION) {
      const details = await getNotificationActionDetails(data);
      if (!details.conversationId || !details.messageId) {
        return finishHandledAction(Notifications.BackgroundNotificationTaskResult.Failed);
      }
      await queueConversationRead(userId, details.conversationId, details.messageId);
      await dismissHandledNotification(data);
    } else {
      const item = await queuePendingChatReply(await pendingReplyFromResponse(data, userId));
      await showReplyPending(item);
    }
    return finishHandledAction(Notifications.BackgroundNotificationTaskResult.NewData);
  }
}

if (!TaskManager.isTaskDefined(HUBIT_NOTIFICATION_BACKGROUND_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    HUBIT_NOTIFICATION_BACKGROUND_TASK,
    ({ data, error }) => handleNotificationBackgroundTask(data, error),
  );
}

if (Platform.OS === 'android') {
  void Notifications.registerTaskAsync(HUBIT_NOTIFICATION_BACKGROUND_TASK).catch(() => undefined);
}

import * as Notifications from 'expo-notifications';
import {
  HUBIT_CHAT_REPLY_RETRY_CATEGORY,
  HUBIT_NOTIFICATION_CHANNELS,
} from './nativePush';
import type { PendingChatReply } from './pendingNotificationReplies';

export function pendingReplyNotificationId(item: Pick<PendingChatReply, 'id'>): string {
  return `hubit-reply:${item.id.slice(-40)}`;
}

async function replaceFeedback(
  item: PendingChatReply,
  title: string,
  body: string,
  retryable: boolean,
): Promise<void> {
  const identifier = pendingReplyNotificationId(item);
  await Notifications.dismissNotificationAsync(item.notificationId).catch(() => undefined);
  await Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body,
      sound: false,
      categoryIdentifier: retryable ? HUBIT_CHAT_REPLY_RETRY_CATEGORY : undefined,
      data: {
        route: item.route,
        channel: 'chat',
        pending_action_id: item.id,
      },
    },
    trigger: { channelId: HUBIT_NOTIFICATION_CHANNELS.chat },
  });
}

export async function showReplyPending(item: PendingChatReply): Promise<void> {
  await replaceFeedback(item, 'Ответ сохранён', 'Нет сети — отправим после восстановления подключения.', true)
    .catch(() => undefined);
}

export async function showReplySent(item: PendingChatReply): Promise<void> {
  await replaceFeedback(item, 'Ответ отправлен', 'Сообщение доставлено в чат HUB-IT.', false)
    .catch(() => undefined);
}

export async function showReplyFailed(item: PendingChatReply): Promise<void> {
  await replaceFeedback(item, 'Ответ не отправлен', 'Откройте чат и повторите отправку.', false)
    .catch(() => undefined);
}

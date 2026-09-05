import * as Notifications from 'expo-notifications';
import {
  HUBIT_CHAT_REPLY_RETRY_CATEGORY,
  HUBIT_NOTIFICATION_CHANNELS,
} from './nativePush';
import type { PendingChatReply } from './pendingNotificationReplies';

const NOTIFICATION_OPERATION_TIMEOUT_MS = 1_500;

async function settleNotificationOperation(operation: () => Promise<unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(false), NOTIFICATION_OPERATION_TIMEOUT_MS);
    try {
      void operation().then(() => finish(true), () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export function pendingReplyNotificationId(item: Pick<PendingChatReply, 'id'>): string {
  return `hubit-reply:${item.id.slice(-40)}`;
}

async function replaceFeedback(
  item: PendingChatReply,
  title: string,
  body: string,
  retryable: boolean,
): Promise<void> {
  const fallbackIdentifier = pendingReplyNotificationId(item);
  const sourceIdentifier = String(item.notificationId || '').trim();
  const feedbackIdentifier = sourceIdentifier || fallbackIdentifier;
  const presented = await settleNotificationOperation(() => Notifications.scheduleNotificationAsync({
    // Android closes RemoteInput only when the app updates the same notification
    // tag/id that received the reply. A separate identifier leaves some OEM
    // notification drawers in the indefinite "sending" state.
    identifier: feedbackIdentifier,
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
  }));
  if (fallbackIdentifier !== feedbackIdentifier) {
    void settleNotificationOperation(
      () => Notifications.dismissNotificationAsync(fallbackIdentifier),
    );
  }
  if (!presented && sourceIdentifier) {
    await settleNotificationOperation(
      () => Notifications.dismissNotificationAsync(sourceIdentifier),
    );
  }
}

export async function showReplySending(item: PendingChatReply): Promise<void> {
  await replaceFeedback(
    item,
    'Отправка ответа…',
    'Сообщение отправляется в чат HUB-IT.',
    false,
  ).catch(() => undefined);
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

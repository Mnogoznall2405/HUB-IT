import * as Notifications from 'expo-notifications';
import {
  HUBIT_CHAT_REPLY_RETRY_CATEGORY,
  HUBIT_NOTIFICATION_CHANNELS,
} from './nativePush';
import type { PendingChatReply } from './pendingNotificationReplies';

const NOTIFICATION_OPERATION_TIMEOUT_MS = 1_500;
// The confirmation stays just long enough to read, then leaves the drawer by itself.
const SENT_CONFIRMATION_VISIBLE_MS = 1_200;

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

const ORIGIN_CHANNEL_IDS: ReadonlySet<string> = new Set([
  HUBIT_NOTIFICATION_CHANNELS.chat,
  HUBIT_NOTIFICATION_CHANNELS.chatAi,
]);

// The backend stamps data.channelId on every push. Feedback for an AI-chat reply
// must stay on hubit_chat_ai, so the user's channel settings apply to it. The
// source notification is still presented until its feedback replaces it; the
// feedback writes the same channelId into its own data, so later updates agree.
async function originChannelId(sourceIdentifier: string): Promise<string> {
  let channelId = null as string | null;
  if (sourceIdentifier) {
    await settleNotificationOperation(async () => {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const match = presented.find((item) => item.request.identifier === sourceIdentifier);
      const data = match?.request.content.data as Record<string, unknown> | undefined;
      channelId = String(data?.channelId || '').trim();
    });
  }
  return channelId && ORIGIN_CHANNEL_IDS.has(channelId) ? channelId : HUBIT_NOTIFICATION_CHANNELS.chat;
}

async function replaceFeedback(
  item: PendingChatReply,
  title: string,
  body: string,
  retryable: boolean,
  autoDismissMs = 0,
): Promise<void> {
  const fallbackIdentifier = pendingReplyNotificationId(item);
  const sourceIdentifier = String(item.notificationId || '').trim();
  const feedbackIdentifier = sourceIdentifier || fallbackIdentifier;
  const channelId = await originChannelId(sourceIdentifier);
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
        channelId,
        pending_action_id: item.id,
      },
    },
    trigger: { channelId },
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
    return;
  }
  if (presented && autoDismissMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, autoDismissMs));
    await settleNotificationOperation(
      () => Notifications.dismissNotificationAsync(feedbackIdentifier),
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
  await replaceFeedback(item, 'Ответ отправлен', 'Сообщение доставлено в чат HUB-IT.', false, SENT_CONFIRMATION_VISIBLE_MS)
    .catch(() => undefined);
}

export async function showReplyFailed(item: PendingChatReply): Promise<void> {
  await replaceFeedback(item, 'Ответ не отправлен', 'Откройте чат и повторите отправку.', false)
    .catch(() => undefined);
}

import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as mailApi from '../api/mailApi';
import {
  HUBIT_CHAT_MARK_READ_ACTION,
  HUBIT_CHAT_REPLY_ACTION,
  HUBIT_MAIL_MARK_READ_ACTION,
} from './nativePush';
import { notificationData, portalPathFromNotificationResponse } from './notificationNavigation';

export type NotificationActionResult = {
  kind: 'open' | 'reply' | 'mark_read' | 'mail_mark_read';
  route: string;
};

export type NotificationActionDetails = {
  action: string;
  route: string;
  notificationId: string;
  conversationId: string;
  messageId: string;
  mailboxId: string;
  body: string;
  clientMessageId: string;
};

function normalizedDataText(data: Record<string, unknown>, key: string, maxLength = 128): string {
  return String(data[key] || '').trim().slice(0, maxLength);
}

async function replyClientMessageId(response: Notifications.NotificationResponse): Promise<string> {
  const requestId = String(response.notification.request.identifier || '').trim();
  const source = `${requestId}|${HUBIT_CHAT_REPLY_ACTION}`;
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, source);
  return `android-reply:${digest}`;
}

export async function dismissHandledNotification(response: Notifications.NotificationResponse): Promise<void> {
  const identifier = String(response.notification.request.identifier || '').trim();
  if (!identifier) return;
  void Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
}

export async function getNotificationActionDetails(
  response: Notifications.NotificationResponse,
): Promise<NotificationActionDetails> {
  const data = notificationData(response);
  return {
    action: String(response.actionIdentifier || '').trim(),
    route: portalPathFromNotificationResponse(response),
    notificationId: String(response.notification.request.identifier || '').trim(),
    conversationId: normalizedDataText(data, 'conversation_id'),
    messageId: normalizedDataText(data, 'message_id', 8_192),
    mailboxId: normalizedDataText(data, 'mailbox_id', 256),
    body: String(response.userText || '').trim(),
    clientMessageId: response.actionIdentifier === HUBIT_CHAT_REPLY_ACTION
      ? await replyClientMessageId(response)
      : '',
  };
}

export async function processNotificationAction(
  response: Notifications.NotificationResponse,
): Promise<NotificationActionResult> {
  const details = await getNotificationActionDetails(response);
  const { action, route, conversationId, messageId, mailboxId, body } = details;
  if (action === HUBIT_MAIL_MARK_READ_ACTION) {
    await mailApi.markMailMessageRead(messageId, mailboxId);
    await dismissHandledNotification(response);
    return { kind: 'mail_mark_read', route };
  }
  if (action !== HUBIT_CHAT_REPLY_ACTION && action !== HUBIT_CHAT_MARK_READ_ACTION) {
    return { kind: 'open', route };
  }

  if (!conversationId) throw new Error('В уведомлении отсутствует идентификатор чата');

  if (action === HUBIT_CHAT_MARK_READ_ACTION) {
    await chatApi.markConversationRead(conversationId, messageId || undefined);
    await dismissHandledNotification(response);
    return { kind: 'mark_read', route };
  }

  if (!body) throw new Error('Введите текст ответа');
  if (body.length > 12000) throw new Error('Ответ превышает 12 000 символов');
  await chatApi.sendTextMessage(conversationId, body, {
    clientMessageId: details.clientMessageId,
    replyToMessageId: messageId || undefined,
  });
  await chatApi.markConversationRead(conversationId, messageId || undefined).catch(() => undefined);
  // The background feedback layer updates this exact notification identifier.
  // Dismissing here races with the final "sent" update and can leave Android's
  // RemoteInput UI spinning or remove the confirmation after it is posted.
  return { kind: 'reply', route };
}

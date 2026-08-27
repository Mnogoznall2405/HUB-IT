import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as mailApi from '../api/mailApi';
import {
  HUBIT_CHAT_MARK_READ_ACTION,
  HUBIT_CHAT_REPLY_ACTION,
  HUBIT_MAIL_MARK_READ_ACTION,
} from './nativePush';
import { processNotificationAction } from './notificationActions';

jest.mock('../api/chatApi', () => ({
  sendTextMessage: jest.fn(),
  markConversationRead: jest.fn(),
}));
jest.mock('../api/mailApi', () => ({ markMailMessageRead: jest.fn() }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(),
}));

function response(actionIdentifier: string, userText?: string): NotificationResponse {
  return {
    actionIdentifier,
    userText,
    notification: {
      request: {
        identifier: 'chat:msg:message-7',
        content: {
          data: {
            route: '/chat?conversation=conversation-2&message=message-7',
            conversation_id: 'conversation-2',
            message_id: 'message-7',
          },
        },
      },
    },
  } as unknown as NotificationResponse;
}

beforeEach(() => {
  (Crypto.digestStringAsync as jest.Mock).mockResolvedValue('a'.repeat(64));
  (chatApi.sendTextMessage as jest.Mock).mockResolvedValue({ id: 'sent-1' });
  (chatApi.markConversationRead as jest.Mock).mockResolvedValue(undefined);
});

it('sends an idempotent Chat reply and marks the source message read', async () => {
  await expect(processNotificationAction(response(HUBIT_CHAT_REPLY_ACTION, '  Ответ  ')))
    .resolves.toMatchObject({ kind: 'reply' });

  expect(chatApi.sendTextMessage).toHaveBeenCalledWith('conversation-2', 'Ответ', {
    clientMessageId: `android-reply:${'a'.repeat(64)}`,
    replyToMessageId: 'message-7',
  });
  expect(chatApi.markConversationRead).toHaveBeenCalledWith('conversation-2', 'message-7');
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('chat:msg:message-7');
});

it('marks a conversation read without creating a message', async () => {
  await expect(processNotificationAction(response(HUBIT_CHAT_MARK_READ_ACTION)))
    .resolves.toMatchObject({ kind: 'mark_read' });
  expect(chatApi.sendTextMessage).not.toHaveBeenCalled();
  expect(chatApi.markConversationRead).toHaveBeenCalledWith('conversation-2', 'message-7');
});

it('rejects an empty quick reply', async () => {
  await expect(processNotificationAction(response(HUBIT_CHAT_REPLY_ACTION, '  ')))
    .rejects.toThrow('Введите текст ответа');
  expect(chatApi.sendTextMessage).not.toHaveBeenCalled();
});

it('marks the exact mailbox-scoped mail message read and dismisses its notification', async () => {
  const mailResponse = response(HUBIT_MAIL_MARK_READ_ACTION);
  mailResponse.notification.request.identifier = 'mail:message-7';
  mailResponse.notification.request.content.data = {
    route: '/mail?folder=inbox&message=message-7&mailbox_id=mailbox-2',
    message_id: 'message-7',
    mailbox_id: 'mailbox-2',
  };

  await expect(processNotificationAction(mailResponse)).resolves.toMatchObject({
    kind: 'mail_mark_read',
  });
  expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('message-7', 'mailbox-2');
  expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('mail:message-7');
  expect(chatApi.markConversationRead).not.toHaveBeenCalled();
});

import * as Notifications from 'expo-notifications';
import type { NotificationResponse } from 'expo-notifications';
import * as chatApi from '../api/chatApi';
import * as mailApi from '../api/mailApi';
import * as tokenStore from '../auth/tokenStore';
import { reconcileNativeBadge } from './notificationBadge';
import { getPendingChatReplyCount } from './pendingNotificationReplies';
import { HUBIT_CHAT_REPLY_ACTION, HUBIT_MAIL_MARK_READ_ACTION } from './nativePush';
import { handleNotificationBackgroundTask } from './notificationBackgroundTask';

jest.mock('../api/chatApi', () => ({
  sendTextMessage: jest.fn(),
  markConversationRead: jest.fn(async () => undefined),
}));
jest.mock('../api/mailApi', () => ({ markMailMessageRead: jest.fn(async () => undefined) }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async () => 'a'.repeat(64)),
}));
jest.mock('./notificationBadge', () => ({
  reconcileNativeBadge: jest.fn(async () => 0),
}));

function response(): NotificationResponse {
  return {
    actionIdentifier: HUBIT_CHAT_REPLY_ACTION,
    userText: 'Ответ из уведомления',
    notification: {
      request: {
        identifier: 'chat:msg:message-7',
        content: {
          data: {
            route: '/chat?conversation=conversation-2&message=message-7',
            conversation_id: 'conversation-2',
            message_id: 'message-7',
            recipient_user_id: '7',
          },
        },
      },
    },
  } as unknown as NotificationResponse;
}

describe('notification background action task', () => {
  beforeEach(() => {
    jest.spyOn(tokenStore, 'getSessionUserId').mockResolvedValue(7);
    (chatApi.sendTextMessage as jest.Mock).mockReset().mockResolvedValue({ id: 'sent-1' });
    (chatApi.markConversationRead as jest.Mock).mockReset().mockResolvedValue(undefined);
    jest.mocked(reconcileNativeBadge).mockReset().mockResolvedValue(0);
    jest.mocked(Notifications.dismissNotificationAsync).mockReset().mockResolvedValue(undefined);
    jest.mocked(Notifications.scheduleNotificationAsync).mockReset().mockResolvedValue('feedback');
    jest.mocked(Notifications.clearLastNotificationResponseAsync).mockReset().mockResolvedValue(undefined);
  });

  it('sends a quick reply without opening the app and shows delivery state', async () => {
    await expect(handleNotificationBackgroundTask(response())).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    );
    expect(chatApi.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Ответ отправлен' }),
      }),
    );
  });

  it('returns after delivery when badge reconciliation stalls', async () => {
    jest.mocked(reconcileNativeBadge).mockImplementationOnce(
      () => new Promise<number | null>(() => undefined),
    );

    const result = await Promise.race([
      handleNotificationBackgroundTask(response()).then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);

    expect(result).toBe('completed');
  });

  it('returns after delivery when clearing the native response stalls', async () => {
    jest.mocked(Notifications.clearLastNotificationResponseAsync).mockImplementationOnce(
      () => new Promise<void>(() => undefined),
    );

    const result = await Promise.race([
      handleNotificationBackgroundTask(response()).then(() => 'completed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);

    expect(result).toBe('completed');
  });

  it('updates RemoteInput under the same identifier before waiting for the chat request', async () => {
    let resolveSend: ((value: { id: string }) => void) | undefined;
    (chatApi.sendTextMessage as jest.Mock).mockImplementationOnce(
      () => new Promise<{ id: string }>((resolve) => {
        resolveSend = resolve;
      }),
    );

    const task = handleNotificationBackgroundTask(response());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith('chat:msg:message-7');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: 'chat:msg:message-7',
        content: expect.objectContaining({ title: 'Отправка ответа…' }),
      }),
    );

    resolveSend?.({ id: 'sent-1' });
    await expect(task).resolves.toBe(Notifications.BackgroundNotificationTaskResult.NewData);
  });

  it('stops a stalled quick reply and saves it for retry instead of leaving Android pending', async () => {
    jest.useFakeTimers();
    try {
      (chatApi.sendTextMessage as jest.Mock).mockImplementationOnce(
        () => new Promise(() => undefined),
      );

      const task = handleNotificationBackgroundTask(response());
      await jest.advanceTimersByTimeAsync(8_000);

      await expect(task).resolves.toBe(Notifications.BackgroundNotificationTaskResult.NewData);
      expect(await getPendingChatReplyCount(7)).toBe(1);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Ответ сохранён' }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('stores the exact reply and exposes retry state when offline', async () => {
    (chatApi.sendTextMessage as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      code: 'ERR_NETWORK',
      config: {},
    });

    await expect(handleNotificationBackgroundTask(response())).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    );
    expect(await getPendingChatReplyCount(7)).toBe(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Ответ сохранён' }),
      }),
    );
  });

  it('does not execute a notification left by another signed-in user', async () => {
    jest.spyOn(tokenStore, 'getSessionUserId').mockResolvedValueOnce(8);

    await expect(handleNotificationBackgroundTask(response())).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.Failed,
    );
    expect(chatApi.sendTextMessage).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  });

  it('marks a mailbox-scoped message read without opening the app', async () => {
    const mailResponse = response();
    mailResponse.actionIdentifier = HUBIT_MAIL_MARK_READ_ACTION;
    mailResponse.notification.request.identifier = 'mail:message-7';
    mailResponse.notification.request.content.data = {
      route: '/mail?folder=inbox&message=message-7&mailbox_id=mailbox-2',
      message_id: 'message-7',
      mailbox_id: 'mailbox-2',
      recipient_user_id: '7',
    };

    await expect(handleNotificationBackgroundTask(mailResponse)).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.NewData,
    );
    expect(mailApi.markMailMessageRead).toHaveBeenCalledWith('message-7', 'mailbox-2');
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('mail:message-7');
  });

  it('keeps the mail notification visible when marking it read fails offline', async () => {
    (mailApi.markMailMessageRead as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      code: 'ERR_NETWORK',
      config: {},
    });
    const mailResponse = response();
    mailResponse.actionIdentifier = HUBIT_MAIL_MARK_READ_ACTION;
    mailResponse.notification.request.identifier = 'mail:message-offline';
    mailResponse.notification.request.content.data = {
      route: '/mail?message=message-offline&mailbox_id=mailbox-2',
      message_id: 'message-offline',
      mailbox_id: 'mailbox-2',
      recipient_user_id: '7',
    };

    await expect(handleNotificationBackgroundTask(mailResponse)).resolves.toBe(
      Notifications.BackgroundNotificationTaskResult.Failed,
    );
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalled();
    expect(await getPendingChatReplyCount(7)).toBe(0);
  });
});

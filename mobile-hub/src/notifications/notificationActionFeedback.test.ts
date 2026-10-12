import * as Notifications from 'expo-notifications';
import { showReplySending, showReplySent } from './notificationActionFeedback';
import type { PendingChatReply } from './pendingNotificationReplies';

const reply: PendingChatReply = {
  id: 'android-reply:reply-1',
  userId: 7,
  conversationId: 'conversation-2',
  messageId: 'message-7',
  body: 'Ответ',
  notificationId: 'chat:msg:message-7',
  route: '/chat?conversation=conversation-2&message=message-7',
  createdAt: 1,
  attempts: 0,
};

describe('notification action feedback channel', () => {
  const presentedWith = (channelId: unknown) => Object.assign(Notifications, {
    getPresentedNotificationsAsync: jest.fn(async () => [{
      request: { identifier: reply.notificationId, content: { data: { channelId } }, trigger: null },
    }]),
  });
  afterEach(() => {
    delete (Notifications as { getPresentedNotificationsAsync?: unknown }).getPresentedNotificationsAsync;
  });

  it('posts the feedback on hubit_chat_ai when the source AI-chat push carries that channel', async () => {
    presentedWith('hubit_chat_ai');

    await showReplySending(reply);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      identifier: reply.notificationId,
      content: expect.objectContaining({ data: expect.objectContaining({ channelId: 'hubit_chat_ai' }) }),
      trigger: { channelId: 'hubit_chat_ai' },
    }));
  });

  it('falls back to hubit_chat when the source is no longer presented', async () => {
    await showReplySending(reply);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { channelId: 'hubit_chat' },
    }));
  });

  it('ignores an unknown channel from the push data', async () => {
    presentedWith('some_other_channel');

    await showReplySending(reply);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { channelId: 'hubit_chat' },
    }));
  });
});

describe('notification action feedback', () => {
  it('updates the source notification identifier so Android closes RemoteInput', async () => {
    await showReplySending(reply);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: reply.notificationId,
        content: expect.objectContaining({ title: 'Отправка ответа…' }),
      }),
    );
    expect(Notifications.dismissNotificationAsync).not.toHaveBeenCalledWith(reply.notificationId);
  });

  it('replaces the sending state with the final state under the same identifier', async () => {
    await showReplySending(reply);
    await showReplySent(reply);

    expect(Notifications.scheduleNotificationAsync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        identifier: reply.notificationId,
        content: expect.objectContaining({ title: 'Отправка ответа…' }),
      }),
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identifier: reply.notificationId,
        content: expect.objectContaining({ title: 'Ответ отправлен' }),
      }),
    );
  });

  it('keeps the source dismissed when feedback presentation fails', async () => {
    jest.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('unavailable'));

    await showReplySending(reply);

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(reply.notificationId);
  });

  it('does not wait forever when the Android notification API stalls', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(
        () => new Promise<string>(() => undefined),
      );

      const feedback = showReplySending(reply);
      await jest.advanceTimersByTimeAsync(1_500);
      await expect(feedback).resolves.toBeUndefined();
      expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith(reply.notificationId);
    } finally {
      jest.useRealTimers();
    }
  });
});

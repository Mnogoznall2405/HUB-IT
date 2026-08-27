import * as chatApi from '../api/chatApi';
import {
  clearPendingChatReplies,
  drainPendingChatReplies,
  getPendingChatReplyCount,
  queuePendingChatReply,
  retryPendingChatReply,
} from './pendingNotificationReplies';

jest.mock('../api/chatApi', () => ({
  sendTextMessage: jest.fn(async () => ({ id: 'message-sent' })),
  markConversationRead: jest.fn(async () => undefined),
}));

function item() {
  return {
    id: 'android-reply:abc',
    userId: 7,
    conversationId: 'conversation-1',
    messageId: 'message-1',
    body: 'Ответ без потери текста',
    notificationId: 'chat:msg:message-1',
    route: '/chat?conversation=conversation-1',
  };
}

function networkError() {
  return { isAxiosError: true, code: 'ERR_NETWORK', config: {}, message: 'offline' };
}

describe('pending notification replies', () => {
  beforeEach(async () => {
    await clearPendingChatReplies();
    (chatApi.sendTextMessage as jest.Mock).mockReset().mockResolvedValue({ id: 'message-sent' });
    (chatApi.markConversationRead as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('deduplicates the same idempotent quick reply', async () => {
    await queuePendingChatReply(item());
    await queuePendingChatReply(item());

    expect(await getPendingChatReplyCount(7)).toBe(1);
  });

  it('keeps reply text while the network is unavailable', async () => {
    await queuePendingChatReply(item());
    (chatApi.sendTextMessage as jest.Mock).mockRejectedValue(networkError());

    await expect(retryPendingChatReply(item().id, 7)).resolves.toMatchObject({ status: 'pending' });
    expect(await getPendingChatReplyCount(7)).toBe(1);
  });

  it('replays a reply with the original client message id and clears it', async () => {
    await queuePendingChatReply(item());

    await expect(drainPendingChatReplies(7)).resolves.toMatchObject({ remaining: 0 });
    expect(chatApi.sendTextMessage).toHaveBeenCalledWith(
      'conversation-1',
      'Ответ без потери текста',
      { clientMessageId: 'android-reply:abc', replyToMessageId: 'message-1' },
    );
    expect(await getPendingChatReplyCount(7)).toBe(0);
  });

  it('discards a definitive forbidden reply instead of retrying forever', async () => {
    await queuePendingChatReply(item());
    (chatApi.sendTextMessage as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      config: {},
      response: { status: 403 },
    });

    await expect(retryPendingChatReply(item().id, 7)).resolves.toMatchObject({ status: 'discarded' });
    expect(await getPendingChatReplyCount(7)).toBe(0);
  });
});

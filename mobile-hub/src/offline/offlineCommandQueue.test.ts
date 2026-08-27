import * as chatApi from '../api/chatApi';
import {
  clearOfflineCommandQueue,
  drainOfflineCommandQueue,
  getOfflineCommandCount,
  markConversationReadResilient,
  queueConversationRead,
} from './offlineCommandQueue';

jest.mock('../api/chatApi', () => ({
  markConversationRead: jest.fn(async () => undefined),
}));

function networkError() {
  return { isAxiosError: true, code: 'ERR_NETWORK', config: {}, message: 'offline' };
}

describe('offline command queue', () => {
  beforeEach(async () => {
    await clearOfflineCommandQueue();
    (chatApi.markConversationRead as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('queues only retryable idempotent read markers and deduplicates exact commands', async () => {
    (chatApi.markConversationRead as jest.Mock).mockRejectedValue(networkError());

    await expect(markConversationReadResilient(7, 'conversation-1', 'message-1')).resolves.toBe('queued');
    await queueConversationRead(7, 'conversation-1', 'message-1');

    expect(await getOfflineCommandCount(7)).toBe(1);
    expect(await getOfflineCommandCount(8)).toBe(0);
  });

  it('replays queued read markers and removes successful commands', async () => {
    await queueConversationRead(7, 'conversation-1', 'message-1');
    await queueConversationRead(7, 'conversation-1', 'message-2');

    await expect(drainOfflineCommandQueue(7)).resolves.toBe(0);

    expect(chatApi.markConversationRead).toHaveBeenNthCalledWith(1, 'conversation-1', 'message-1');
    expect(chatApi.markConversationRead).toHaveBeenNthCalledWith(2, 'conversation-1', 'message-2');
    expect(await getOfflineCommandCount(7)).toBe(0);
  });

  it('keeps the current and following commands when connectivity is still unavailable', async () => {
    await queueConversationRead(7, 'conversation-1', 'message-1');
    await queueConversationRead(7, 'conversation-2', 'message-2');
    (chatApi.markConversationRead as jest.Mock).mockRejectedValue(networkError());

    await expect(drainOfflineCommandQueue(7)).resolves.toBe(2);
    expect(chatApi.markConversationRead).toHaveBeenCalledTimes(1);
  });

  it('does not turn definitive server errors into false offline success', async () => {
    (chatApi.markConversationRead as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      config: {},
      response: { status: 403 },
    });

    await expect(markConversationReadResilient(7, 'conversation-1', 'message-1')).rejects.toMatchObject({
      response: { status: 403 },
    });
    expect(await getOfflineCommandCount(7)).toBe(0);
  });
});

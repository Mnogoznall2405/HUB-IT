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

  it('preserves concurrent enqueues and additions made during a drain', async () => {
    await Promise.all([queueConversationRead(7, 'a', '1'), queueConversationRead(7, 'b', '2')]);
    expect(await getOfflineCommandCount(7)).toBe(2);
    let finish!: () => void;
    let started = false;
    (chatApi.markConversationRead as jest.Mock).mockImplementationOnce(() => {
      started = true;
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const drain = drainOfflineCommandQueue(7);
    for (let i = 0; i < 50 && !started; i++) await Promise.resolve();
    expect(started).toBe(true);
    await queueConversationRead(7, 'c', '3');
    finish();
    await drain;
    expect(await getOfflineCommandCount(7)).toBe(1);
    await drainOfflineCommandQueue(7);
    expect(chatApi.markConversationRead).toHaveBeenLastCalledWith('c', '3');
  });

  it('does not restore a drained command after clearing and isolates another user drain', async () => {
    await queueConversationRead(7, 'old', '1');
    await queueConversationRead(8, 'other', '2');
    let fail!: (error: unknown) => void;
    let started = false;
    (chatApi.markConversationRead as jest.Mock).mockImplementationOnce(() => {
      started = true;
      return new Promise((_, reject) => { fail = reject; });
    });
    const drain = drainOfflineCommandQueue(7);
    for (let i = 0; i < 50 && !started; i++) await Promise.resolve();
    expect(started).toBe(true);
    await drainOfflineCommandQueue(8);
    expect(chatApi.markConversationRead).toHaveBeenCalledWith('other', '2');
    await clearOfflineCommandQueue();
    await queueConversationRead(8, 'new', '3');
    fail(networkError());
    await drain;
    expect(await getOfflineCommandCount(7)).toBe(0);
    expect(await getOfflineCommandCount(8)).toBe(1);
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

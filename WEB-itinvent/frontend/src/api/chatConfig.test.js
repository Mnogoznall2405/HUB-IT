import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from './client';
import { chatConfigAPI, getChatConfigCached, resetChatConfigCache } from './chatConfig';

describe('chatConfigAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChatConfigCache();
  });

  it('requests the chat config from the dedicated endpoint', async () => {
    apiClient.get.mockResolvedValue({ data: { group_max_members: 128 } });

    await expect(chatConfigAPI.getConfig()).resolves.toEqual({ group_max_members: 128 });
    expect(apiClient.get).toHaveBeenCalledWith('/chat/config');
  });

  it('deduplicates concurrent calls and caches the result for the session', async () => {
    apiClient.get.mockResolvedValue({ data: { group_max_members: 64 } });

    const [first, second] = await Promise.all([getChatConfigCached(), getChatConfigCached()]);
    expect(first).toEqual({ group_max_members: 64 });
    expect(second).toEqual({ group_max_members: 64 });
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    await getChatConfigCached();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('does not poison the cache after a failed request', async () => {
    apiClient.get
      .mockRejectedValueOnce(new Error('Сеть недоступна'))
      .mockResolvedValueOnce({ data: { group_max_members: 256 } });

    await expect(getChatConfigCached()).rejects.toThrow('Сеть недоступна');
    await expect(getChatConfigCached()).resolves.toEqual({ group_max_members: 256 });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});

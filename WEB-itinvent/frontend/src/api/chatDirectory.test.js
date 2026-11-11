import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from './client';
import { chatDirectoryAPI } from './chatDirectory';

describe('chatDirectoryAPI AI conversations and memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a generic conversation without a bot id', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'conversation-1', kind: 'ai' } });

    await expect(chatDirectoryAPI.createAiConversation()).resolves.toEqual({ id: 'conversation-1', kind: 'ai' });
    expect(apiClient.post).toHaveBeenCalledWith('/chat/ai/conversations');
  });

  it('uses distinct open and create endpoints for pinned bots', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'conversation-1' } });

    await chatDirectoryAPI.openAiBotConversation('bot/1');
    await chatDirectoryAPI.createAiBotConversation('bot/1');

    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/chat/ai/bots/bot%2F1/open');
    expect(apiClient.post).toHaveBeenNthCalledWith(2, '/chat/ai/bots/bot%2F1/conversations');
  });

  it('routes context reset and personal-memory CRUD to scoped endpoints', async () => {
    apiClient.get.mockResolvedValue({ data: { enabled: true, items: [] } });
    apiClient.post.mockResolvedValue({ data: { ok: true } });
    apiClient.patch.mockResolvedValue({ data: { ok: true } });
    apiClient.delete.mockResolvedValue({ data: { ok: true } });

    await chatDirectoryAPI.getAiMemory();
    await chatDirectoryAPI.updateAiMemorySettings(false);
    await chatDirectoryAPI.updateAiMemoryItem('memory/1', 'Новый факт');
    await chatDirectoryAPI.deleteAiMemoryItem('memory/1');
    await chatDirectoryAPI.clearAiMemory();
    await chatDirectoryAPI.resetAiConversationContext('conversation/1');

    expect(apiClient.get).toHaveBeenCalledWith('/chat/ai/memory');
    expect(apiClient.patch).toHaveBeenNthCalledWith(1, '/chat/ai/memory/settings', { enabled: false });
    expect(apiClient.patch).toHaveBeenNthCalledWith(2, '/chat/ai/memory/memory%2F1', { content: 'Новый факт' });
    expect(apiClient.delete).toHaveBeenNthCalledWith(1, '/chat/ai/memory/memory%2F1');
    expect(apiClient.delete).toHaveBeenNthCalledWith(2, '/chat/ai/memory');
    expect(apiClient.post).toHaveBeenCalledWith('/chat/ai/conversations/conversation%2F1/reset-context');
  });

  it('saves a chat attachment to My Files only through the explicit endpoint', async () => {
    apiClient.post.mockResolvedValue({ data: { id: 'my-file-1' } });

    await chatDirectoryAPI.saveAttachmentToMyFiles('message/1', 'attachment/1');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/chat/messages/message%2F1/attachments/attachment%2F1/save-to-my-files',
    );
  });
});

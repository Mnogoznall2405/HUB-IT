import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from './client';
import { chatAiSandboxAPI } from './chatAiSandbox';

describe('chatAiSandboxAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { enabled: true } });
    apiClient.post.mockResolvedValue({ data: { ok: true } });
  });

  it('loads one sandbox conversation and answers a scoped permission request', async () => {
    await chatAiSandboxAPI.getConversation('conversation/1');
    await chatAiSandboxAPI.respondPermission('permission/1', { decision: 'allow', scope: 'session' });

    expect(apiClient.get).toHaveBeenCalledWith('/chat/ai/sandbox/conversations/conversation%2F1');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/chat/ai/sandbox/permissions/permission%2F1/respond',
      { decision: 'allow', scope: 'session' },
    );
  });

  it('attaches either the complete workspace archive or one selected file', async () => {
    await chatAiSandboxAPI.attachArchive('conversation/1');
    await chatAiSandboxAPI.attachFile('file/1');

    expect(apiClient.post).toHaveBeenNthCalledWith(
      1,
      '/chat/ai/sandbox/conversations/conversation%2F1/archive/attach',
    );
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      '/chat/ai/sandbox/files/file%2F1/attach',
    );
  });
});

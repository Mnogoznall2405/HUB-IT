import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatConversationActionsController from './useChatConversationActionsController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    deleteConversation: vi.fn(),
    leaveGroup: vi.fn(),
    updateConversationSettings: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

describe('useChatConversationActionsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requestDeleteConversation blocks task chats with info notice', () => {
    const notifyInfo = vi.fn();
    const { result } = renderHook(() => useChatConversationActionsController({
      activeConversationId: 'c1',
      handleRemoteConversationRemoved: vi.fn(),
      notifyApiError: vi.fn(),
      notifyInfo,
      setConversations: vi.fn(),
      upsertSearchConversation: vi.fn(),
    }));

    act(() => {
      result.current.requestDeleteConversation({ id: 'task-1', kind: 'task', task_id: 10 });
    });

    expect(notifyInfo).toHaveBeenCalled();
    expect(result.current.conversationActionTarget).toBeNull();
  });

  it('confirmConversationAction deletes conversation and clears target', async () => {
    chatAPI.deleteConversation.mockResolvedValue({});
    const handleRemoteConversationRemoved = vi.fn();
    const { result } = renderHook(() => useChatConversationActionsController({
      activeConversationId: 'c1',
      handleRemoteConversationRemoved,
      notifyApiError: vi.fn(),
      notifyInfo: vi.fn(),
      setConversations: vi.fn(),
      upsertSearchConversation: vi.fn(),
    }));

    act(() => {
      result.current.requestDeleteConversation({ id: 'c9', kind: 'direct' });
    });

    await act(async () => {
      await result.current.confirmConversationAction();
    });

    expect(chatAPI.deleteConversation).toHaveBeenCalledWith('c9');
    expect(handleRemoteConversationRemoved).toHaveBeenCalledWith('c9');
    expect(result.current.conversationActionTarget).toBeNull();
  });

  it('updateConversationSettings calls API and upserts search', async () => {
    chatAPI.updateConversationSettings.mockResolvedValue({ id: 'c1', title: 'New' });
    const setConversations = vi.fn((updater) => updater([{ id: 'c1', title: 'Old' }]));
    const upsertSearchConversation = vi.fn();

    const { result } = renderHook(() => useChatConversationActionsController({
      activeConversationId: 'c1',
      handleRemoteConversationRemoved: vi.fn(),
      notifyApiError: vi.fn(),
      notifyInfo: vi.fn(),
      setConversations,
      upsertSearchConversation,
    }));

    await act(async () => {
      await result.current.updateConversationSettings({ muted: true });
    });

    expect(chatAPI.updateConversationSettings).toHaveBeenCalledWith('c1', { muted: true });
    expect(upsertSearchConversation).toHaveBeenCalledWith({ id: 'c1', title: 'New' });
  });
});
